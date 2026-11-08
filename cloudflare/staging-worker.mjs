const PLAID_URL = "https://sandbox.plaid.com";
const FLOWPAY_ORIGIN = "https://flowpay-6aay.onrender.com";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
function json(data, status = 200, cors = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...cors
    }
  });
}
function b64decode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}
function b64encode(bytes) {
  let result = "";
  for (const b of bytes) result += String.fromCharCode(b);
  return btoa(result);
}
function parseJwtPart(value) {
  return JSON.parse(decoder.decode(b64decode(value)));
}
let jwksCache = null;
let jwksExpiry = 0;
async function authenticate(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) throw Error("Missing token");
  const parts = auth.slice(7).trim().split(".");
  if (parts.length !== 3) throw Error("Invalid JWT");
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = parseJwtPart(headerPart);
  const claims = parseJwtPart(payloadPart);
  const base = (env.SUPABASE_URL || "").replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base)) {
    throw Error("Invalid Supabase URL");
  }
  const issuer = `${base}/auth/v1`;
  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    !["RS256", "ES256"].includes(header.alg) ||
    typeof header.kid !== "string" ||
    claims.iss !== issuer ||
    !audiences.includes("authenticated") ||
    claims.role !== "authenticated" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claims.sub || "") ||
    typeof claims.exp !== "number" ||
    claims.exp <= now ||
    (typeof claims.nbf === "number" && claims.nbf > now) ||
    (typeof claims.iat === "number" && claims.iat > now + 60)
  ) {
    throw Error("Invalid claims");
  }
  async function refreshKeys() {
    const response = await fetch(`${issuer}/.well-known/jwks.json`);
    if (!response.ok) throw Error("JWKS unavailable");
    const data = await response.json();
    if (!Array.isArray(data.keys)) throw Error("Invalid JWKS");
    jwksCache = data.keys;
    jwksExpiry = Date.now() + 300000;
  }
  if (!jwksCache || Date.now() >= jwksExpiry) {
    await refreshKeys();
  }
  const matches = key =>
    key.kid === header.kid &&
    key.alg === header.alg &&
    key.use !== "enc" &&
    (header.alg === "ES256"
      ? key.kty === "EC" && key.crv === "P-256"
      : key.kty === "RSA");
  let jwk = jwksCache.find(matches);
  if (!jwk) {
    await refreshKeys();
    jwk = jwksCache.find(matches);
  }
  if (!jwk) throw Error("Signing key not found");
  const algorithm = header.alg === "ES256"
    ? { name: "ECDSA", namedCurve: "P-256" }
    : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
  const key = await crypto.subtle.importKey(
    "jwk", jwk, algorithm, false, ["verify"]
  );
  const valid = await crypto.subtle.verify(
    header.alg === "ES256"
      ? { name: "ECDSA", hash: "SHA-256" }
      : { name: "RSASSA-PKCS1-v1_5" },
    key,
    b64decode(signaturePart),
    encoder.encode(`${headerPart}.${payloadPart}`)
  );
  if (!valid) throw Error("Invalid signature");
  return {
    id: claims.sub,
    email: claims.email || null
  };
}
function getKeyBytes(value) {
  if (!value) throw Error("Encryption key missing");
  const key = value.trim();
  if (/^[0-9a-f]{64}$/i.test(key)) {
    return Uint8Array.from(key.match(/../g), x => parseInt(x, 16));
  }
  const bytes = b64decode(key);
  if (bytes.length !== 32) throw Error("Encryption key must be 32 bytes");
  return bytes;
}
async function encryptionKey(env) {
  return crypto.subtle.importKey(
    "raw",
    getKeyBytes(env.TOKEN_ENCRYPTION_KEY),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"]
  );
}
async function encryptToken(token, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(env);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(token)
  );
  return {
    encrypted: b64encode(new Uint8Array(encrypted)),
    iv: b64encode(iv)
  };
}
async function decryptToken(row, env) {
  const key = await encryptionKey(env);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64decode(row.token_iv) },
    key,
    b64decode(row.encrypted_access_token)
  );
  return decoder.decode(decrypted);
}
async function plaid(env, endpoint, body = {}) {
  if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) {
    throw Error("Plaid credentials missing");
  }
  const response = await fetch(`${PLAID_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.PLAID_CLIENT_ID,
      secret: env.PLAID_SECRET,
      ...body
    })
  });
  const result = await response.json();
  if (!response.ok) {
    const error = Error("Plaid request failed");
    error.code = result.error_code || "PLAID_ERROR";
    throw error;
  }
  return result;
}
async function ensureUser(env, userId) {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO users (id) VALUES (?)"
  ).bind(userId).run();
}
async function getConnection(env, userId, id) {
  return env.DB.prepare(
    "SELECT * FROM bank_connections WHERE id = ? AND user_id = ?"
  ).bind(id, userId).first();
}
async function audit(env, userId, action, type, resourceId) {
  await env.DB.prepare(
    `INSERT INTO security_audit_log
     (id, user_id, action, resource_type, resource_id)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(),
    userId,
    action,
    type,
    resourceId || null
  ).run();
}
async function hasBankConsent(env, userId, connectionId = null) {
  const row = await env.DB.prepare(
    `SELECT id FROM user_consents
     WHERE user_id = ?
       AND consent_type = 'bank_connection'
       AND withdrawn_at IS NULL
       AND (connection_id IS NULL OR connection_id = ?)
     ORDER BY granted_at DESC
     LIMIT 1`
  ).bind(userId, connectionId).first();
  return !!row;
}
async function saveAccounts(env, connectionId, accounts) {
  for (const a of accounts) {
    await env.DB.prepare(
      `INSERT INTO bank_accounts
       (id, connection_id, name, mask, type, subtype,
        current_balance, available_balance, balance_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         mask = excluded.mask,
         type = excluded.type,
         subtype = excluded.subtype,
         current_balance = excluded.current_balance,
         available_balance = excluded.available_balance,
         balance_updated_at = CURRENT_TIMESTAMP`
    ).bind(
      a.account_id,
      connectionId,
      a.name || "Account",
      a.mask || null,
      a.type || null,
      a.subtype || null,
      a.balances?.current ?? null,
      a.balances?.available ?? null
    ).run();
  }
}
async function saveTransaction(env, tx) {
  const category =
    tx.personal_finance_category?.primary ||
    tx.category?.[0] ||
    null;
  await env.DB.prepare(
    `INSERT INTO bank_transactions
     (id, account_id, amount, transaction_date,
      merchant_name, description, pending, category)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       account_id = excluded.account_id,
       amount = excluded.amount,
       transaction_date = excluded.transaction_date,
       merchant_name = excluded.merchant_name,
       description = excluded.description,
       pending = excluded.pending,
       category = excluded.category`
  ).bind(
    tx.transaction_id,
    tx.account_id,
    tx.amount,
    tx.date,
    tx.merchant_name || null,
    tx.name || null,
    tx.pending ? 1 : 0,
    category
  ).run();
}
async function readJson(request, maxBytes = 4096) {
  const raw = await request.text();
  if (encoder.encode(raw).byteLength > maxBytes) {
    const error = Error("Payload too large");
    error.status = 413;
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch {
    const error = Error("Invalid JSON");
    error.status = 400;
    throw error;
  }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowed = origin === FLOWPAY_ORIGIN;
    const cors = allowed
      ? {
          "Access-Control-Allow-Origin": FLOWPAY_ORIGIN,
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Vary": "Origin"
        }
      : { "Vary": "Origin" };
    const send = (data, status = 200) => json(data, status, cors);
    if (request.method === "OPTIONS") {
      return allowed
        ? new Response(null, { status: 204, headers: cors })
        : send({ error: "Origin not allowed" }, 403);
    }
    const endpoints = [
      "/me",
      "/test-plaid",
      "/link-token",
      "/exchange-token",
      "/user-data",
      "/bank-accounts",
      "/bank-transactions",
      "/sync-transactions",
      "/consent",
      "/consent/withdraw",
      "/my-data"
    ];
    if (url.pathname === "/" && request.method === "GET") {
      return send({
        app: "FlowPay Plaid API",
        status: "online",
        plaidEnvironment: "sandbox",
        staging: true,
        endpoints: ["/", ...endpoints]
      });
    }
    if (env.PLAID_ENV !== "sandbox") {
      return send({ error: "Sandbox only" }, 403);
    }
    const connectionMatch = url.pathname.match(
      /^\/bank-connections\/([0-9a-f-]{36})$/i
    );
    if (!endpoints.includes(url.pathname) && !connectionMatch) {
      return send({ error: "Endpoint not found" }, 404);
    }
    let user;
    try {
      user = await authenticate(request, env);
    } catch {
      return send({ success: false, error: "Unauthorized" }, 401);
    }
    if (
      !env.STAGING_TEST_USER_ID ||
      user.id !== env.STAGING_TEST_USER_ID
    ) {
      return send({
        success: false,
        error: "Staging access restricted"
      }, 403);
    }
    if (url.pathname === "/me" && request.method === "GET") {
      return send({ success: true, user });
    }
    if (!env.DB) {
      return send({ error: "Database unavailable" }, 503);
    }
    try {
      // CONSENT: READ
      if (url.pathname === "/consent" && request.method === "GET") {
        const rows = await env.DB.prepare(
          `SELECT id, consent_type, policy_version,
                  granted_at, withdrawn_at, connection_id
           FROM user_consents
           WHERE user_id = ?
           ORDER BY granted_at DESC
           LIMIT 100`
        ).bind(user.id).all();
        return send({
          success: true,
          consents: rows.results || []
        });
      }
      // Withdraw all active bank-connection consents for the signed-in user.
      // Keep connections and encrypted tokens; this endpoint deletes no records.
      if (url.pathname === "/consent/withdraw" && request.method === "POST") {
        if (!allowed) return send({ error: "Origin not allowed" }, 403);
        const body = await readJson(request);
        if (body?.consent_type !== "bank_connection") {
          return send({ error: "Expected bank_connection consent_type" }, 400);
        }
        const results = await env.DB.batch([
          env.DB.prepare(
            `UPDATE user_consents SET withdrawn_at = CURRENT_TIMESTAMP
             WHERE user_id = ? AND consent_type = 'bank_connection'
               AND withdrawn_at IS NULL`
          ).bind(user.id),
          env.DB.prepare(
            `INSERT INTO security_audit_log
             (id, user_id, action, resource_type, resource_id)
             VALUES (?, ?, 'consent_withdrawn', 'user', ?)`
          ).bind(crypto.randomUUID(), user.id, user.id)
        ]);
        return send({ success: true, withdrawn: true,
          consents_updated: results[0].meta?.changes || 0 });
      }
      // CONSENT: RECORD
      if (url.pathname === "/consent" && request.method === "POST") {
        if (!allowed) return send({ error: "Origin not allowed" }, 403);
        const body = await readJson(request);
        if (
          body?.agreed !== true ||
          !["bank_connection", "privacy_policy"].includes(body.consent_type) ||
          typeof body.policy_version !== "string" ||
          !/^[A-Za-z0-9._-]{1,64}$/.test(body.policy_version)
        ) {
          return send({ error: "Valid explicit consent required" }, 400);
        }
        await ensureUser(env, user.id);
        const consentId = crypto.randomUUID();
        await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO user_consents
             (id, user_id, consent_type, policy_version)
             VALUES (?, ?, ?, ?)`
          ).bind(
            consentId,
            user.id,
            body.consent_type,
            body.policy_version
          ),
          env.DB.prepare(
            `INSERT INTO security_audit_log
             (id, user_id, action, resource_type, resource_id)
             VALUES (?, ?, 'consent_granted', 'consent', ?)`
          ).bind(
            crypto.randomUUID(),
            user.id,
            consentId
          )
        ]);
        return send({
          success: true,
          consent_id: consentId
        }, 201);
      }
      // BANK DISCONNECTION
      if (connectionMatch && request.method === "DELETE") {
        if (!allowed) return send({ error: "Origin not allowed" }, 403);
        const connectionId = connectionMatch[1];
        const connection = await getConnection(env, user.id, connectionId);
        if (!connection) {
          return send({ error: "Connection not found" }, 404);
        }
        const token = await decryptToken(connection, env);
        try {
          await plaid(env, "/item/remove", { access_token: token });
        } catch (error) {
          if (error.code !== "INVALID_ACCESS_TOKEN") throw error;
        }
        await env.DB.batch([
          env.DB.prepare(
            `DELETE FROM bank_transactions
             WHERE account_id IN (
               SELECT id FROM bank_accounts WHERE connection_id = ?
             )`
          ).bind(connectionId),
          env.DB.prepare(
            "DELETE FROM bank_accounts WHERE connection_id = ?"
          ).bind(connectionId),
          env.DB.prepare(
            "DELETE FROM bank_connections WHERE id = ? AND user_id = ?"
          ).bind(connectionId, user.id),
          env.DB.prepare(
            `UPDATE user_consents
             SET withdrawn_at = CURRENT_TIMESTAMP
             WHERE user_id = ? AND consent_type = 'bank_connection'
               AND withdrawn_at IS NULL
               AND (connection_id = ? OR (
                 connection_id IS NULL AND NOT EXISTS (
                   SELECT 1 FROM bank_connections WHERE user_id = ?
                 )
               ))`
          ).bind(user.id, connectionId, user.id),
          env.DB.prepare(
            `INSERT INTO security_audit_log
             (id, user_id, action, resource_type, resource_id)
             VALUES (?, ?, 'bank_disconnected', 'bank_connection', ?)`
          ).bind(crypto.randomUUID(), user.id, connectionId)
        ]);
        return send({ success: true, disconnected: true });
      }
      // DELETE ALL USER FINANCIAL DATA
      if (url.pathname === "/my-data" && request.method === "DELETE") {
        if (!allowed) return send({ error: "Origin not allowed" }, 403);
        const body = await readJson(request, 1024);
        if (body?.confirmation !== "DELETE MY FLOWPAY DATA") {
          return send({ error: "Deletion confirmation required" }, 400);
        }
        const rows = await env.DB.prepare(
          "SELECT * FROM bank_connections WHERE user_id = ?"
        ).bind(user.id).all();
        for (const connection of rows.results || []) {
          const token = await decryptToken(connection, env);
          try {
            await plaid(env, "/item/remove", { access_token: token });
          } catch (error) {
            if (error.code !== "INVALID_ACCESS_TOKEN") throw error;
          }
        }
        await env.DB.batch([
          env.DB.prepare(
            `DELETE FROM bank_transactions
             WHERE account_id IN (
               SELECT a.id FROM bank_accounts a
               JOIN bank_connections c ON c.id = a.connection_id
               WHERE c.user_id = ?
             )`
          ).bind(user.id),
          env.DB.prepare(
            `DELETE FROM bank_accounts
             WHERE connection_id IN (
               SELECT id FROM bank_connections WHERE user_id = ?
             )`
          ).bind(user.id),
          env.DB.prepare(
            "DELETE FROM bank_connections WHERE user_id = ?"
          ).bind(user.id),
          env.DB.prepare(
            "DELETE FROM user_data WHERE user_id = ?"
          ).bind(user.id),
          env.DB.prepare(
            "DELETE FROM user_consents WHERE user_id = ?"
          ).bind(user.id),
          env.DB.prepare(
            "DELETE FROM security_audit_log WHERE user_id = ?"
          ).bind(user.id),
          env.DB.prepare(
            "DELETE FROM users WHERE id = ?"
          ).bind(user.id)
        ]);
        return send({
          success: true,
          deleted: true,
          auth_account_deleted: false,
          message: "D1 records deleted. Supabase account remains active."
        });
      }
      // CLOUD STORAGE: READ
      if (url.pathname === "/user-data" && request.method === "GET") {
        const row = await env.DB.prepare(
          `SELECT data_json, revision, updated_at
           FROM user_data WHERE user_id = ?`
        ).bind(user.id).first();
        return send(row ? {
          success: true,
          exists: true,
          data: JSON.parse(row.data_json),
          revision: row.revision,
          updated_at: row.updated_at
        } : {
          success: true,
          exists: false,
          data: null,
          revision: 0,
          updated_at: null
        });
      }
      // CLOUD STORAGE: WRITE
      if (url.pathname === "/user-data" && request.method === "PUT") {
        if (!allowed) return send({ error: "Origin not allowed" }, 403);
        const body = await readJson(request, 512 * 1024);
        if (
          !body ||
          !Number.isSafeInteger(body.revision) ||
          body.revision < 0 ||
          !body.data ||
          typeof body.data !== "object" ||
          Array.isArray(body.data)
        ) {
          return send({ error: "Expected revision and data object" }, 400);
        }
        const serialized = JSON.stringify(body.data);
        if (encoder.encode(serialized).byteLength > 500 * 1024) {
          return send({ error: "Data too large" }, 413);
        }
        await ensureUser(env, user.id);
        let result;
        if (body.revision === 0) {
          result = await env.DB.prepare(
            `INSERT OR IGNORE INTO user_data
             (user_id, data_json, revision)
             VALUES (?, ?, 1)`
          ).bind(user.id, serialized).run();
        } else {
          result = await env.DB.prepare(
            `UPDATE user_data SET
               data_json = ?,
               revision = revision + 1,
               updated_at = CURRENT_TIMESTAMP
             WHERE user_id = ? AND revision = ?`
          ).bind(serialized, user.id, body.revision).run();
        }
        if (result.meta?.changes !== 1) {
          const current = await env.DB.prepare(
            "SELECT revision FROM user_data WHERE user_id = ?"
          ).bind(user.id).first();
          return send({
            success: false,
            error: "Revision conflict",
            current_revision: current?.revision || 0
          }, 409);
        }
        return send({
          success: true,
          revision: body.revision + 1
        });
      }
      // PLAID CONNECTIVITY
      if (url.pathname === "/test-plaid" && request.method === "GET") {
        const result = await plaid(env, "/institutions/get", {
          count: 1,
          offset: 0,
          country_codes: ["US"]
        });
        return send({
          success: true,
          message: "Connected to Plaid Sandbox",
          institutionsReturned: result.institutions?.length || 0
        });
      }
      // PLAID LINK TOKEN
      if (url.pathname === "/link-token" && request.method === "POST") {
        if (!allowed) return send({ error: "Origin not allowed" }, 403);
        if (!(await hasBankConsent(env, user.id))) {
          return send({ error: "Bank connection consent required" }, 403);
        }
        const result = await plaid(env, "/link/token/create", {
          client_name: "FlowPay",
          language: "en",
          country_codes: ["US"],
          products: ["transactions"],
          user: { client_user_id: user.id }
        });
        return send({
          success: true,
          link_token: result.link_token,
          expiration: result.expiration
        });
      }
      // EXCHANGE PUBLIC TOKEN
      if (url.pathname === "/exchange-token" && request.method === "POST") {
        if (!allowed) return send({ error: "Origin not allowed" }, 403);
        const body = await readJson(request);
        if (
          typeof body?.public_token !== "string" ||
          !body.public_token.startsWith("public-") ||
          body.public_token.length > 1000
        ) {
          return send({ error: "Invalid public token" }, 400);
        }
        if (!(await hasBankConsent(env, user.id))) {
          return send({ error: "Bank connection consent required" }, 403);
        }
        await encryptionKey(env);
        const exchanged = await plaid(
          env,
          "/item/public_token/exchange",
          { public_token: body.public_token }
        );
        const existing = await env.DB.prepare(
          `SELECT id FROM bank_connections
           WHERE user_id = ? AND item_id = ?`
        ).bind(user.id, exchanged.item_id).first();
        if (existing) {
          return send({
            success: true,
            connection_id: existing.id,
            already_connected: true
          });
        }
        const accounts = await plaid(env, "/accounts/get", {
          access_token: exchanged.access_token
        });
        const encrypted = await encryptToken(exchanged.access_token, env);
        await ensureUser(env, user.id);
        const connectionId = crypto.randomUUID();
        await env.DB.prepare(
          `INSERT INTO bank_connections
           (id, user_id, institution_name, item_id,
            encrypted_access_token, token_iv)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
          connectionId,
          user.id,
          typeof body.institution_name === "string"
            ? body.institution_name.slice(0, 150)
            : null,
          exchanged.item_id,
          encrypted.encrypted,
          encrypted.iv
        ).run();
        await saveAccounts(env, connectionId, accounts.accounts || []);
        await audit(env, user.id, "bank_connected", "bank_connection", connectionId);
        return send({
          success: true,
          connection_id: connectionId,
          accounts_saved: accounts.accounts?.length || 0
        });
      }
      // BANK ACCOUNTS
      if (url.pathname === "/bank-accounts" && request.method === "GET") {
        const refresh = url.searchParams.get("refresh") === "true";
        if (refresh) {
          const connections = await env.DB.prepare(
            "SELECT * FROM bank_connections WHERE user_id = ?"
          ).bind(user.id).all();
          for (const connection of connections.results || []) {
            if (!(await hasBankConsent(env, user.id, connection.id))) {
              return send({ error: "Bank connection consent required" }, 403);
            }
          }
          for (const connection of connections.results || []) {
            const token = await decryptToken(connection, env);
            const result = await plaid(env, "/accounts/get", {
              access_token: token
            });
            await saveAccounts(env, connection.id, result.accounts || []);
            await audit(env, user.id, "balances_refreshed", "bank_connection", connection.id);
          }
        }
        const rows = await env.DB.prepare(
          `SELECT a.id, a.name, a.mask, a.type, a.subtype,
                  a.current_balance, a.available_balance,
                  a.balance_updated_at,
                  c.id AS connection_id, c.institution_name
           FROM bank_accounts a
           JOIN bank_connections c ON c.id = a.connection_id
           WHERE c.user_id = ?
           ORDER BY c.created_at DESC, a.name`
        ).bind(user.id).all();
        return send({
          success: true,
          accounts: rows.results || []
        });
      }
      // TRANSACTION SYNCHRONIZATION
      if (url.pathname === "/sync-transactions" &&
          request.method === "POST") {
        if (!allowed) return send({ error: "Origin not allowed" }, 403);
        const body = await readJson(request);
        if (typeof body?.connection_id !== "string") {
          return send({ error: "Missing connection_id" }, 400);
        }
        const connection = await getConnection(
          env, user.id, body.connection_id
        );
        if (!connection) {
          return send({ error: "Connection not found" }, 404);
        }
        if (!(await hasBankConsent(env, user.id, connection.id))) {
          return send({ error: "Bank connection consent required" }, 403);
        }
        const token = await decryptToken(connection, env);
        let cursor = connection.sync_cursor || "";
        let hasMore = true;
        let pages = 0;
        let added = 0;
        let modified = 0;
        let removed = 0;
        const additions = [];
        const modifications = [];
        const removals = [];
        while (hasMore) {
          if (++pages > 100) {
            return send({
              error: "Too many sync pages; no changes saved"
            }, 503);
          }
          const page = await plaid(env, "/transactions/sync", {
            access_token: token,
            cursor,
            count: 100
          });
          additions.push(...(page.added || []));
          modifications.push(...(page.modified || []));
          removals.push(...(page.removed || []));
          cursor = page.next_cursor;
          hasMore = page.has_more;
        }
        const accounts = await env.DB.prepare(
          "SELECT id FROM bank_accounts WHERE connection_id = ?"
        ).bind(connection.id).all();
        const accountIds = new Set(
          (accounts.results || []).map(a => a.id)
        );
        for (const tx of [...additions, ...modifications]) {
          if (!accountIds.has(tx.account_id)) {
            return send({ error: "Transaction account mismatch" }, 502);
          }
        }
        for (const tx of additions) {
          await saveTransaction(env, tx);
          added++;
        }
        for (const tx of modifications) {
          await saveTransaction(env, tx);
          modified++;
        }
        for (const tx of removals) {
          const result = await env.DB.prepare(
            `DELETE FROM bank_transactions
             WHERE id = ?
               AND account_id IN (
                 SELECT id FROM bank_accounts
                 WHERE connection_id = ?
               )`
          ).bind(tx.transaction_id, connection.id).run();
          removed += result.meta?.changes || 0;
        }
        await env.DB.prepare(
          `UPDATE bank_connections
           SET sync_cursor = ?,
               last_synced_at = CURRENT_TIMESTAMP
           WHERE id = ? AND user_id = ?`
        ).bind(cursor, connection.id, user.id).run();
        await audit(env, user.id, "transactions_synced", "bank_connection", connection.id);
        return send({
          success: true,
          added,
          modified,
          removed,
          pages,
          has_more: false
        });
      }
      // TRANSACTION HISTORY
      if (url.pathname === "/bank-transactions" &&
          request.method === "GET") {
        const rows = await env.DB.prepare(
          `SELECT t.id, t.account_id, t.amount,
                  t.transaction_date, t.merchant_name,
                  t.description, t.pending, t.category,
                  a.name AS account_name, c.institution_name
           FROM bank_transactions t
           JOIN bank_accounts a ON a.id = t.account_id
           JOIN bank_connections c ON c.id = a.connection_id
           WHERE c.user_id = ?
           ORDER BY t.transaction_date DESC, t.id DESC
           LIMIT 200`
        ).bind(user.id).all();
        return send({
          success: true,
          transactions: rows.results || []
        });
      }
      return send({ error: "Method not allowed" }, 405);
    } catch (error) {
      console.error(
        "FlowPay API error:",
        error.code || "INTERNAL_ERROR"
      );
      if (error.status === 400 || error.status === 413) {
        return send({ success: false, error: error.message }, error.status);
      }
      return send({
        success: false,
        error: "Request failed"
      }, 500);
    }
  }
};
