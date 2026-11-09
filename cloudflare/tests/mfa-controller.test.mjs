import test from "node:test";
import assert from "node:assert/strict";
import { createMfaController } from "../flowpay-mfa.mjs";
function client({ session = true, factors = [], level = "aal1" } = {}) {
  const calls = [];
  const mfa = {
    listFactors: async () => ({ data: { totp: factors }, error: null }),
    getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: level, nextLevel: factors.length ? "aal2" : "aal1" }, error: null }),
    enroll: async input => { calls.push(["enroll", input]); return { data: { id: "new", totp: { qr_code: "data:image/svg+xml;base64,abc", secret: "test" } }, error: null }; },
    challenge: async input => { calls.push(["challenge", input]); return { data: { id: "challenge" }, error: null }; },
    verify: async input => { calls.push(["verify", input]); level = "aal2"; return { data: {}, error: null }; },
    unenroll: async input => { calls.push(["unenroll", input]); return { data: {}, error: null }; }
  };
  return { auth: { mfa, getSession: async () => ({ data: { session: session ? {} : null }, error: null }) }, calls };
}
test("signed-out session never ready", async () => {
  assert.equal((await createMfaController(client({ session: false })).status()).state, "signed-out");
});
test("existing user without factors requires enrollment", async () => {
  assert.equal((await createMfaController(client()).status()).state, "enrollment-required");
});
test("verified factor at aal1 requires challenge", async () => {
  assert.equal((await createMfaController(client({ factors: [{ id: "one", status: "verified" }] })).status()).state, "challenge-required");
});
test("aal2 is ready", async () => {
  assert.equal((await createMfaController(client({ level: "aal2" })).status()).state, "ready");
});
test("TOTP enrollment and challenge verify", async () => {
  const c = client({ factors: [{ id: "one", status: "verified" }] });
  const controller = createMfaController(c);
  assert.equal((await controller.enroll()).factorId, "new");
  await assert.rejects(controller.verify("one", "12"));
  assert.equal((await controller.verify("one", "123456")).state, "ready");
  assert.deepEqual(c.calls.at(-1), ["verify", { factorId: "one", challengeId: "challenge", code: "123456" }]);
});
test("cannot remove last factor", async () => {
  const c = client({ level: "aal2", factors: [{ id: "one", status: "verified" }] });
  await assert.rejects(createMfaController(c).removeFactor("one"), /last verified factor/);
});
