import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import worker from "../staging-worker.mjs";

const cryptoApi = globalThis.crypto || webcrypto;
const b64url = value => Buffer.from(value).toString("base64url");
const userId = "00000000-0000-4000-8000-000000000001";
const base = "https://flowpay-mfa-test.supabase.co";
const env = {
  SUPABASE_URL: base,
  PLAID_ENV: "sandbox",
  STAGING_TEST_USER_ID: userId,
  REQUIRE_MFA_AAL2: "true"
};
const keys = await cryptoApi.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256" },
  true, ["sign", "verify"]
);
const jwk = { ...(await cryptoApi.subtle.exportKey("jwk", keys.publicKey)), kid: "mfa-test-key", alg: "RS256", use: "sig" };
async function token(aal, overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", kid: jwk.kid, typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: base + "/auth/v1", aud: "authenticated", role: "authenticated",
    sub: userId, exp: now + 300, iat: now - 5, aal, ...overrides
  }));
  const data = header + "." + payload;
  const signature = await cryptoApi.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(data));
  return data + "." + b64url(Buffer.from(signature));
}
async function call(path, jwt, method = "GET") {
  return worker.fetch(new Request("https://worker.example.test" + path, {
    method, headers: { Authorization: "Bearer " + jwt, Origin: "https://flowpay-staging.onrender.com" }
  }), env);
}
test("real signed AAL1 JWT cannot access financial routes; AAL2 passes MFA gate", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(url, base + "/auth/v1/.well-known/jwks.json");
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  };
  try {
    const aal1 = await token("aal1");
    const denied = await call("/bank-accounts", aal1);
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error, "MFA_REQUIRED");
    const me = await call("/me", aal1);
    assert.equal(me.status, 200);
    const identity = await me.json();
    assert.equal(identity.user.aal, "aal1");
    assert.equal(JSON.stringify(identity).includes("bank_accounts"), false);
    const aal2 = await token("aal2");
    const accepted = await call("/bank-accounts", aal2);
    // No DB binding in this test: 503 confirms the request passed MFA and reached backend checks.
    assert.equal(accepted.status, 503);
    const bad = await call("/bank-accounts", await token("aal2", { sub: "00000000-0000-4000-8000-000000000002" }));
    assert.equal(bad.status, 403);
    assert.equal((await bad.json()).error, "Staging access restricted");
    for (const claims of [
      { exp: Math.floor(Date.now() / 1000) - 1 },
      { iss: "https://attacker.example/auth/v1" },
      { role: "anon" },
      { aud: "anon" },
      { nbf: Math.floor(Date.now() / 1000) + 3600 }
    ]) {
      const invalid = await call("/bank-accounts", await token("aal2", claims));
      assert.equal(invalid.status, 401, JSON.stringify(claims));
    }
    const valid = await token("aal2");
    const pieces = valid.split(".");
    const tamperedPayload = JSON.parse(Buffer.from(pieces[1], "base64url").toString());
    tamperedPayload.email = "forged@example.test";
    pieces[1] = b64url(JSON.stringify(tamperedPayload));
    const forged = await call("/bank-accounts", pieces.join("."));
    assert.equal(forged.status, 401);
    const missingAal = await call("/bank-accounts", await token(undefined));
    assert.equal(missingAal.status, 403);
    assert.equal((await missingAal.json()).error, "MFA_REQUIRED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("session enforcement rejects revoked signed JWT and hides session id from /me", async () => {
  const sessionId = "00000000-0000-4000-8000-000000000005";
  const jwt = await token("aal2", { session_id: sessionId });
  env.REQUIRE_ACTIVE_SESSION = "true";
  env.SESSION_LOOKUP = { get: async () => null };
  try {
    const denied = await call("/bank-accounts", jwt);
    assert.equal(denied.status, 401);
    assert.equal((await denied.json()).error, "SESSION_INVALID");
    const me = await call("/me", jwt);
    assert.equal(me.status, 401);
    assert.equal((await me.json()).error, "SESSION_INVALID");
    env.SESSION_LOOKUP = { get: async id => ({ id, user_id: userId, not_after: null }) };
    const validMe = await call("/me", jwt);
    assert.equal(validMe.status, 200);
    assert.equal(Object.hasOwn((await validMe.json()).user, "session_id"), false);
    const allowed = await call("/bank-accounts", jwt);
    assert.equal(allowed.status, 503); // valid session passes to missing staging DB
    delete env.SESSION_LOOKUP;
    const unavailable = await call("/bank-accounts", jwt);
    assert.equal(unavailable.status, 401);
  } finally {
    delete env.REQUIRE_ACTIVE_SESSION;
    delete env.SESSION_LOOKUP;
  }
});
