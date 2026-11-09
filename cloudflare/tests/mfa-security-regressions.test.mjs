import test from "node:test";
import assert from "node:assert/strict";
import { createMfaController } from "../flowpay-mfa.mjs";

function mock({ signedIn = true, level = "aal1", factors = [] } = {}) {
  const calls = [];
  const auth = {
    getSession: async () => ({ data: { session: signedIn ? { user: { id: "test-user" } } : null }, error: null }),
    mfa: {
      listFactors: async () => ({ data: { totp: factors }, error: null }),
      getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: level, nextLevel: "aal2" }, error: null }),
      enroll: async () => ({ data: { id: "pending", totp: { qr_code: "data:image/svg+xml;base64,YQ==", secret: "test-secret" } }, error: null }),
      challenge: async args => { calls.push(["challenge", args]); return { data: { id: "challenge-id" }, error: null }; },
      verify: async args => { calls.push(["verify", args]); return { data: {}, error: null }; },
      unenroll: async args => { calls.push(["unenroll", args]); return { data: {}, error: null }; }
    }
  };
  return { auth, calls };
}

test("verification does not grant access unless session reaches aal2", async () => {
  const client = mock({ factors: [{ id: "totp-1", status: "verified" }] });
  await assert.rejects(createMfaController(client).verify("totp-1", "123456"), /did not establish AAL2/);
  assert.equal(client.calls.filter(([name]) => name === "verify").length, 1);
});

test("an unverified TOTP enrollment is not an authenticated factor", async () => {
  const client = mock({ factors: [{ id: "pending", status: "unverified" }] });
  const result = await createMfaController(client).status();
  assert.equal(result.state, "enrollment-required");
  assert.deepEqual(result.factors, []);
});

test("rejects malformed TOTP codes before requesting a challenge", async () => {
  const client = mock();
  for (const code of ["", "12345", "1234567", "abcdef", "123 456"]) {
    await assert.rejects(createMfaController(client).verify("totp-1", code), /six-digit/);
  }
  assert.deepEqual(client.calls, []);
});

test("cannot unenroll a factor without AAL2", async () => {
  const client = mock({ factors: [{ id: "one", status: "verified" }, { id: "two", status: "verified" }] });
  await assert.rejects(createMfaController(client).removeFactor("one"), /MFA verification required/);
  assert.deepEqual(client.calls, []);
});

test("cannot unenroll last verified factor even at AAL2", async () => {
  const client = mock({ level: "aal2", factors: [{ id: "one", status: "verified" }] });
  await assert.rejects(createMfaController(client).removeFactor("one"), /last verified factor/);
  assert.deepEqual(client.calls, []);
});

test("allows removal of one of two verified factors after AAL2", async () => {
  const client = mock({ level: "aal2", factors: [{ id: "one", status: "verified" }, { id: "two", status: "verified" }] });
  await createMfaController(client).removeFactor("one");
  assert.deepEqual(client.calls, [["unenroll", { factorId: "one" }]]);
});
