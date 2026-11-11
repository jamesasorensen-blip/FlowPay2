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
  // Opt-in staging gate. Do not enable until existing users can enroll and
  // recover MFA; a JWT without verified AAL2 must not access financial data.
  if (env.REQUIRE_AAL2 === "true" && claims.aal !== "aal2") {
    throw Error("MFA verification required");
  }
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
// Never send Link tokens to an unintended OAuth or webhook destination.
function configuredPlaidUrl(value, expectedOrigin, path = null) {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 2048) throw Error("Invalid Plaid URL configuration");
  let parsed;
  try { parsed = new URL(value); } catch { throw Error("Invalid Plaid URL configuration"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
      parsed.hash || parsed.search || parsed.origin !== expectedOrigin ||
      (path !== null && parsed.pathname !== path)) {
    throw Error("Invalid Plaid URL configuration");
  }
  return parsed.href;
}
// Validate envelope shape without rejecting newly introduced Plaid event codes.
// Verified events are acknowledged after recording a privacy-safe delivery receipt.
export function validPlaidWebhookEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return false;
  return typeof event.webhook_type === "string" &&
    /^[A-Z_]{2,64}$/.test(event.webhook_type) &&
    typeof event.webhook_code === "string" &&
    /^[A-Z_]{2,128}$/.test(event.webhook_code) &&
    typeof event.item_id === "string" &&
    /^[a-zA-Z0-9_-]{1,256}$/.test(event.item_id);
}
// Public Plaid webhook receiver. Never accept unverified events or mutate bank data.
async function verifyPlaidWebhook(request, env) {
  const signature = request.headers.get("Plaid-Verification");
  if (!signature || signature.length > 4096) return null;
  const parts = signature.split(".");
  if (parts.length !== 3) return null;
  let header, claims;
  try {
    header = parseJwtPart(parts[0]);
    claims = parseJwtPart(parts[1]);
  } catch { return null; }
  if (header.alg !== "ES256" || typeof header.kid !== "string" ||
      !/^[a-zA-Z0-9-]{1,100}$/.test(header.kid)) return null;
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(claims.iat) || claims.iat > now + 30 ||
      now - claims.iat > 300 ||
      typeof claims.request_body_sha256 !== "string" ||
      !/^[0-9a-f]{64}$/i.test(claims.request_body_sha256)) return null;
  const body = await request.text();
  if (body.length > 65536) return null;
  const response = await plaid(env, "/webhook_verification_key/get", { key_id: header.kid });
  const jwk = response.key;
  if (!jwk || jwk.kid !== header.kid || jwk.kty !== "EC" ||
      jwk.crv !== "P-256" || jwk.alg !== "ES256") return null;
  const key = await crypto.subtle.importKey("jwk", jwk,
    { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const verified = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, key,
    b64decode(parts[2]), encoder.encode(parts[0] + "." + parts[1]));
  if (!verified) return null;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(body)));
  const hex = Array.from(digest, b => b.toString(16).padStart(2, "0")).join("");
  // Fixed-length comparison to avoid short-circuiting on the first mismatch.
  const expected = claims.request_body_sha256.toLowerCase();
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  try { return JSON.parse(body); } catch { return null; }
}
// Fingerprint the verified delivery token, rather than the body alone. Separate
// updates can contain identical bodies and must still receive separate receipts.
export async function recordWebhookReceipt(env, event, verificationToken) {
  if (!env.STAGING_TEST_USER_ID) throw Error("Staging user not configured");
  const connections = await env.DB.prepare(
    "SELECT id, user_id FROM bank_connections WHERE item_id = ?"
  ).bind(event.item_id).all();
  const owners = connections.results || [];
  if (owners.length !== 1 || owners[0].user_id !== env.STAGING_TEST_USER_ID) return;
  const connection = owners[0];
  if (!(await hasBankConsent(env, connection.user_id, connection.id))) return;
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256", encoder.encode(verificationToken)
  ));
  const receiptId = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
  // D1 serializes this batch, so concurrent redeliveries share one receipt.
  // Store no payload, Item ID, user ID, transaction data or verification token.
  const statements = [
    env.DB.prepare(
      "DELETE FROM plaid_webhook_receipts WHERE received_at < datetime('now', '-7 days')"
    ),
    env.DB.prepare(
      `INSERT INTO plaid_webhook_receipts (id, webhook_type, webhook_code)
       VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING`
    ).bind(receiptId, event.webhook_type, event.webhook_code)
  ];
  if (event.webhook_type === "TRANSACTIONS" && event.webhook_code === "SYNC_UPDATES_AVAILABLE") {
    // changes() refers to the preceding receipt insert in the same D1 transaction.
    // A redelivery does not enqueue again. Generations preserve events arriving
    // while an earlier sync is running.
    statements.push(env.DB.prepare(
      `INSERT INTO plaid_sync_jobs (connection_id, generation)
       SELECT ?, 1 WHERE changes() = 1
       ON CONFLICT(connection_id) DO UPDATE SET generation = generation + 1`
    ).bind(connection.id));
  }
  await env.DB.batch(statements);
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
  if (!Array.isArray(accounts)) throw Error("Invalid Plaid accounts response");
  const ids = new Set();
  for (const account of accounts) {
    if (!account || typeof account.account_id !== "string" || !account.account_id ||
        ids.has(account.account_id)) throw Error("Invalid or duplicate Plaid account ID");
    ids.add(account.account_id);
    const existing = await env.DB.prepare(
      "SELECT connection_id FROM bank_accounts WHERE id = ?"
    ).bind(account.account_id).first();
    if (existing && existing.connection_id !== connectionId) {
      throw Error("Plaid account ownership conflict");
    }
  }
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
         balance_updated_at = CURRENT_TIMESTAMP
       WHERE bank_accounts.connection_id = excluded.connection_id`
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
function validPlaidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
}
function transactionStatement(env, tx) {
  const category =
    tx.personal_finance_category?.primary ||
    tx.category?.[0] ||
    null;
  return env.DB.prepare(
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
       category = excluded.category
     WHERE bank_transactions.account_id = excluded.account_id`
  ).bind(
    tx.transaction_id,
    tx.account_id,
    tx.amount,
    tx.date,
    tx.merchant_name || null,
    tx.name || null,
    tx.pending ? 1 : 0,
    category
  );
}
// Both manual refresh and webhook processing use the same per-connection lease.
async function runConnectionSync(env, userId, connectionId, send = json) {
  await env.DB.prepare(
    "INSERT INTO plaid_sync_jobs (connection_id) VALUES (?) ON CONFLICT(connection_id) DO NOTHING"
  ).bind(connectionId).run();
  const leaseToken = crypto.randomUUID();
  const job = await env.DB.prepare(
    `UPDATE plaid_sync_jobs SET lease_token = ?, lease_until = unixepoch() + 300
     WHERE connection_id = ? AND lease_until <= unixepoch() RETURNING *`
  ).bind(leaseToken, connectionId).first();
  if (!job) return send({error: "Transaction sync already running"}, 409);
  let response;
  try {
    const connection = await getConnection(env, userId, connectionId);
    if (!connection || userId !== env.STAGING_TEST_USER_ID ||
        !(await hasBankConsent(env, userId, connectionId))) {
      // Cancel pending work for a disconnected or withdrawn-consent Item.
      await env.DB.prepare(
        "DELETE FROM plaid_sync_jobs WHERE connection_id = ? AND lease_token = ?"
      ).bind(connectionId, leaseToken).run();
      return send({error: "Bank connection consent required"}, 403);
    }
    response = await syncConnection(env, {id: userId}, connection, leaseToken);
    if (response.ok) {
      await env.DB.prepare(
        `UPDATE plaid_sync_jobs SET processed_generation = ?, attempts = 0,
         next_attempt_at = 0 WHERE connection_id = ? AND lease_token = ?`
      ).bind(job.generation, connectionId, leaseToken).run();
    } else {
      await deferSyncJob(env, connectionId, leaseToken, job.attempts);
    }
  } catch {
    await deferSyncJob(env, connectionId, leaseToken, job.attempts);
    response = json({error: "Transaction sync temporarily unavailable"}, 503);
  } finally {
    await env.DB.prepare(
      `UPDATE plaid_sync_jobs SET lease_token = '', lease_until = 0
       WHERE connection_id = ? AND lease_token = ?`
    ).bind(connectionId, leaseToken).run();
  }
  return send(await response.json(), response.status);
}
async function deferSyncJob(env, connectionId, leaseToken, attempts) {
  const delay = Math.min(3600, 30 * 2 ** Math.min(attempts, 7));
  await env.DB.prepare(
    `UPDATE plaid_sync_jobs SET attempts = attempts + 1,
     generation = MAX(generation, processed_generation + 1),
     next_attempt_at = unixepoch() + ? WHERE connection_id = ? AND lease_token = ?`
  ).bind(delay, connectionId, leaseToken).run();
}
export async function processSyncJobs(env) {
  if (env.PLAID_ENV !== "sandbox" || !env.STAGING_TEST_USER_ID) return;
  const jobs = await env.DB.prepare(
    `SELECT j.connection_id FROM plaid_sync_jobs j
     JOIN bank_connections c ON c.id = j.connection_id
     WHERE j.generation > j.processed_generation AND j.next_attempt_at <= unixepoch()
       AND j.lease_until <= unixepoch() AND c.user_id = ?
     ORDER BY j.next_attempt_at, j.connection_id LIMIT 5`
  ).bind(env.STAGING_TEST_USER_ID).all();
  for (const job of jobs.results || []) {
    const response = await runConnectionSync(env, env.STAGING_TEST_USER_ID, job.connection_id);
    if (!response.ok) console.error("FlowPay background sync deferred");
  }
}
async function syncConnection(env, user, connection, leaseToken) {
  const send = json;
  const token = await decryptToken(connection, env);
  const initialCursor = connection.sync_cursor || "";
  let cursor = initialCursor;
  let hasMore = true;
  let pages = 0;
  let added = 0;
  let modified = 0;
  let removed = 0;
  let additions = [];
  let modifications = [];
  let removals = [];
  let paginationRestarts = 0;
  let seenCursors = new Set([initialCursor]);
  while (hasMore) {
    if (++pages > 100) {
      return send({
        error: "Too many sync pages; no changes saved"
      }, 503);
    }
    let page;
    try {
      page = await plaid(env, "/transactions/sync", {
        access_token: token,
        cursor,
        count: 100
      });
    } catch (error) {
      // Plaid requires a full restart from the last committed cursor
      // when transactions mutate during pagination.
      if (error.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" &&
          paginationRestarts < 2) {
        paginationRestarts++;
        cursor = initialCursor;
        hasMore = true;
        pages = 0;
        additions = [];
        modifications = [];
        removals = [];
        seenCursors = new Set([initialCursor]);
        continue;
      }
      throw error;
    }
    // Reject malformed pages before persisting any transactions or cursor.
    // An invalid cursor must never replace the last committed sync position.
    if (
      !page || !Array.isArray(page.added) ||
      !Array.isArray(page.modified) ||
      !Array.isArray(page.removed) ||
      typeof page.next_cursor !== "string" ||
      typeof page.has_more !== "boolean" ||
      (page.has_more && page.next_cursor === cursor)
    ) {
      return send({ error: "Invalid transaction sync response; no changes saved" }, 502);
    }
    if (page.added.length + page.modified.length + page.removed.length > 500 ||
        additions.length + modifications.length + removals.length +
        page.added.length + page.modified.length + page.removed.length > 497) {
      return send({ error: "Transaction sync batch too large; no changes saved" }, 503);
    }
    // Reject a repeated cursor anywhere in this pagination attempt.
    // A cycle longer than one page would otherwise consume the page limit.
    if (seenCursors.has(page.next_cursor) && page.has_more) {
      return send({ error: "Repeated transaction sync cursor; no changes saved" }, 502);
    }
    seenCursors.add(page.next_cursor);
    additions.push(...page.added);
    modifications.push(...page.modified);
    removals.push(...page.removed);
    cursor = page.next_cursor;
    hasMore = page.has_more;
  }
  const accounts = await env.DB.prepare(
    "SELECT id FROM bank_accounts WHERE connection_id = ?"
  ).bind(connection.id).all();
  const accountIds = new Set(
    (accounts.results || []).map(a => a.id)
  );
  // Validate Plaid identifiers and required transaction fields before
  // building any statements; malformed payloads must not advance cursor.
  for (const tx of [...additions, ...modifications]) {
    if (!tx || typeof tx.transaction_id !== "string" ||
        !tx.transaction_id || typeof tx.account_id !== "string" ||
        !tx.account_id || typeof tx.amount !== "number" ||
        !Number.isFinite(tx.amount) || !validPlaidDate(tx.date)) {
      return send({ error: "Invalid transaction fields; no changes saved" }, 502);
    }
  }
  for (const tx of [...additions, ...modifications]) {
    if (!accountIds.has(tx.account_id)) {
      return send({ error: "Transaction account mismatch" }, 502);
    }
  }
  for (const tx of removals) {
    if (!tx || typeof tx.transaction_id !== "string" || !tx.transaction_id) {
      return send({ error: "Invalid removed transaction; no changes saved" }, 502);
    }
  }
  // An upsert conflict on a transaction belonging to another account
  // must not silently succeed and advance the Plaid cursor.
  const incoming = [...additions, ...modifications];
  if (incoming.length) {
    const expectedAccounts = new Map();
    for (const tx of incoming) {
      if (expectedAccounts.has(tx.transaction_id) &&
          expectedAccounts.get(tx.transaction_id) !== tx.account_id) {
        return send({ error: "Conflicting transaction account IDs; no changes saved" }, 409);
      }
      expectedAccounts.set(tx.transaction_id, tx.account_id);
    }
    const ids = [...expectedAccounts.keys()];
    // Keep lookup parameter counts small for D1 and SQLite variants.
    for (let offset = 0; offset < ids.length; offset += 90) {
      const chunk = ids.slice(offset, offset + 90);
      const placeholders = chunk.map(() => "?").join(",");
      const existing = await env.DB.prepare(
        `SELECT id, account_id FROM bank_transactions WHERE id IN (${placeholders})`
      ).bind(...chunk).all();
      if ((existing.results || []).some(tx => tx.account_id !== expectedAccounts.get(tx.id))) {
        return send({ error: "Transaction ownership conflict; no changes saved" }, 409);
      }
    }
  }
  // Bound the atomic batch so unusually large syncs fail without
  // advancing the cursor or risking D1 statement/CPU limits.
  const statementCount = additions.length + modifications.length + removals.length + 3;
  if (statementCount > 500) {
    return send({ error: "Transaction sync batch too large; no changes saved" }, 503);
  }
  // D1 batch executes these statements in a single transaction. The
  // cursor is advanced only if every transaction change succeeds.
  const statements = [
    env.DB.prepare(
      `INSERT OR REPLACE INTO plaid_sync_commit_fence (id)
       SELECT CASE WHEN EXISTS (
         SELECT 1 FROM plaid_sync_jobs j JOIN bank_connections c ON c.id = j.connection_id
         WHERE j.connection_id = ? AND j.lease_token = ? AND j.lease_until > unixepoch()
           AND c.user_id = ? AND COALESCE(c.sync_cursor, '') = ?
           AND EXISTS (SELECT 1 FROM user_consents u WHERE u.user_id = c.user_id
             AND u.consent_type = 'bank_connection' AND u.withdrawn_at IS NULL
             AND (u.connection_id IS NULL OR u.connection_id = c.id))
       ) THEN 1 ELSE 0 END`
    ).bind(connection.id, leaseToken, user.id, initialCursor),
    ...additions.map(tx => transactionStatement(env, tx)),
    ...modifications.map(tx => transactionStatement(env, tx)),
    ...removals.map(tx => env.DB.prepare(
      `DELETE FROM bank_transactions
       WHERE id = ?
         AND account_id IN (
           SELECT id FROM bank_accounts WHERE connection_id = ?
         )`
    ).bind(tx.transaction_id, connection.id)),
    env.DB.prepare(
      `UPDATE bank_connections
       SET sync_cursor = ?, last_synced_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`
    ).bind(cursor, connection.id, user.id),
    env.DB.prepare(
      `INSERT INTO security_audit_log
       (id, user_id, action, resource_type, resource_id)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), user.id, "transactions_synced", "bank_connection", connection.id)
  ];
  const results = await env.DB.batch(statements);
  added = additions.length;
  modified = modifications.length;
  removed = results.slice(1 + additions.length + modifications.length,
    1 + additions.length + modifications.length + removals.length)
    .reduce((total, result) => total + (result.meta?.changes || 0), 0);
  return send({
    success: true,
    added,
    modified,
    removed,
    pages,
    has_more: false
  });
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
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(processSyncJobs(env).catch(() => {
      console.error("FlowPay scheduled sync unavailable");
    }));
  },
  async fetch(request, env, ctx) {
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
      "/plaid-webhook",
      "/exchange-token",
      "/user-data",
      "/bank-accounts",
      "/diagnostics/item-webhook",
      "/diagnostics/fire-webhook",
      "/diagnostics/sync-status",
      "/bank-transactions",
      "/sync-transactions",
      "/consent",
      "/consent/withdraw",
      "/my-data"
    ];
    if (url.pathname === "/" && request.method === "GET") {
      if (env.PLAID_ENV !== "sandbox") {
        return send({ error: "Sandbox only" }, 403);
      }
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
    if (url.pathname === "/plaid-webhook") {
      if (request.method !== "POST") return send({ error: "Method not allowed" }, 405);
      try {
        const event = await verifyPlaidWebhook(request, env);
        if (!validPlaidWebhookEvent(event)) {
          return send({ error: "Invalid webhook" }, 401);
        }
        await recordWebhookReceipt(env, event, request.headers.get("Plaid-Verification"));
        if (ctx) ctx.waitUntil(processSyncJobs(env).catch(() => {
          console.error("FlowPay background sync unavailable");
        }));
        return send({ success: true });
      } catch {
        return send({ error: "Webhook processing unavailable" }, 503);
      }
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
            "DELETE FROM plaid_sync_jobs WHERE connection_id = ?"
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
            `DELETE FROM plaid_sync_jobs WHERE connection_id IN (
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
        const redirectUri = configuredPlaidUrl(env.PLAID_OAUTH_REDIRECT_URI, FLOWPAY_ORIGIN, "/");
        const webhookUri = configuredPlaidUrl(env.PLAID_WEBHOOK_URL, new URL(request.url).origin, "/plaid-webhook");
        const result = await plaid(env, "/link/token/create", {
          client_name: "FlowPay",
          language: "en",
          country_codes: ["US"],
          products: ["transactions"],
          user: { client_user_id: user.id },
          ...(redirectUri ? { redirect_uri: redirectUri } : {}),
          ...(webhookUri ? { webhook: webhookUri } : {})
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
      // Read-only, authenticated, staging-only Plaid webhook diagnostic.
      // Never expose the Item ID, access token, or Plaid's raw response.
      if (url.pathname === "/diagnostics/item-webhook" && request.method === "POST") {
        if (!allowed) return send({ error: "Origin not allowed" }, 403);
        const body = await readJson(request);
        if (typeof body?.connection_id !== "string" ||
            !/^[0-9a-f-]{36}$/i.test(body.connection_id)) {
          return send({ error: "Invalid connection_id" }, 400);
        }
        const connection = await getConnection(env, user.id, body.connection_id);
        if (!connection) return send({ error: "Connection not found" }, 404);
        if (!(await hasBankConsent(env, user.id, connection.id))) {
          return send({ error: "Bank connection consent required" }, 403);
        }
        const accessToken = await decryptToken(connection, env);
        const item = await plaid(env, "/item/get", { access_token: accessToken });
        const actual = item?.item?.webhook;
        const expected = configuredPlaidUrl(
          env.PLAID_WEBHOOK_URL, new URL(request.url).origin, "/plaid-webhook"
        );
        return send({
          success: true,
          webhook_configured: typeof actual === "string" && actual.length > 0,
          webhook_matches_staging: !!expected && actual === expected,
          expected_webhook_configured: !!expected
        });
      }
      // Explicitly requested Sandbox-only test webhook for an owned, consented connection.
      // Plaid's acknowledgement is not proof of delivery; check Worker logs separately.
      if (url.pathname === "/diagnostics/fire-webhook" && request.method === "POST") {
        if (!allowed) return send({ error: "Origin not allowed" }, 403);
        const body = await readJson(request);
        if (typeof body?.connection_id !== "string" ||
            !/^[0-9a-f-]{36}$/i.test(body.connection_id)) {
          return send({ error: "Invalid connection_id" }, 400);
        }
        const connection = await getConnection(env, user.id, body.connection_id);
        if (!connection) return send({ error: "Connection not found" }, 404);
        if (!(await hasBankConsent(env, user.id, connection.id))) {
          return send({ error: "Bank connection consent required" }, 403);
        }
        const expected = configuredPlaidUrl(
          env.PLAID_WEBHOOK_URL, new URL(request.url).origin, "/plaid-webhook"
        );
        if (!expected) return send({ error: "Staging webhook not configured" }, 503);
        const accessToken = await decryptToken(connection, env);
        const item = await plaid(env, "/item/get", { access_token: accessToken });
        if (item?.item?.webhook !== expected) {
          return send({ error: "Staging webhook does not match this connection" }, 409);
        }
        await plaid(env, "/sandbox/item/fire_webhook", {
          access_token: accessToken,
          webhook_type: "TRANSACTIONS",
          webhook_code: "SYNC_UPDATES_AVAILABLE"
        });
        return send({ success: true, accepted_by_plaid: true, delivery_verified: false });
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
      // Authenticated job status for the caller's own connection.
      if (url.pathname === "/diagnostics/sync-status" && request.method === "GET") {
        const connection = await getConnection(env, user.id, url.searchParams.get("connection_id") || "");
        if (!connection) return send({error: "Connection not found"}, 404);
        const job = await env.DB.prepare(
          "SELECT * FROM plaid_sync_jobs WHERE connection_id = ?"
        ).bind(connection.id).first();
        return send({
          pending: !!job && job.generation > job.processed_generation,
          running: !!job && job.lease_until > Math.floor(Date.now() / 1000),
          attempts: job?.attempts || 0,
          next_retry_at: job?.next_attempt_at || null,
          last_synced_at: connection.last_synced_at || null
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
        return runConnectionSync(env, user.id, connection.id, send);

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
