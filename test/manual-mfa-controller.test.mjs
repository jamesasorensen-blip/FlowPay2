import test from "node:test";
import assert from "node:assert/strict";
import { createMfaController } from "../manual-mfa.mjs";
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
  assert.equal((await createMfaController(client({ level: "aal2", factors: [{ id: "one", status: "verified" }] })).status()).state, "ready");
});
test("TOTP enrollment and challenge verify", async () => {
  const c = client({ factors: [{ id: "one", status: "verified" }] });
  const controller = createMfaController(c);
  await assert.rejects(controller.enroll(), /Verify your existing authenticator/);
  await assert.rejects(controller.verify("one", "12"));
  assert.equal((await controller.verify("one", "123456")).state, "ready");
  assert.deepEqual(c.calls.at(-1), ["verify", { factorId: "one", challengeId: "challenge", code: "123456" }]);
});
test("cannot remove last factor", async () => {
  const c = client({ level: "aal2", factors: [{ id: "one", status: "verified" }] });
  await assert.rejects(createMfaController(c).removeFactor("one"), /last verified factor/);
});

test("signed-out status does not request MFA factors or assurance", async () => {
  const c = client({ session: false });
  c.auth.mfa.listFactors = async () => { throw new Error("Must not query factors while signed out"); };
  c.auth.mfa.getAuthenticatorAssuranceLevel = async () => { throw new Error("Must not query assurance while signed out"); };
  assert.equal((await createMfaController(c).status()).state, "signed-out");
});
test("cannot remove a different unverified factor", async () => {
  const c = client({ level: "aal2", factors: [
    { id: "one", status: "verified" },
    { id: "two", status: "verified" }
  ] });
  await assert.rejects(createMfaController(c).removeFactor("unknown"), /not verified/);
  assert.equal(c.calls.some(([name]) => name === "unenroll"), false);
});

test("unfinished named enrollment can be restarted without touching verified factors", async () => {
  const pending = { id: "pending", factor_type: "totp", status: "unverified", friendly_name: "FlowPay authenticator" };
  const c = client({ factors: [pending] });
  const controller = createMfaController(c);
  assert.equal((await controller.status()).pendingFactors.length, 1);
  assert.equal((await controller.restartUnverifiedEnrollment()).factorId, "new");
  assert.deepEqual(c.calls.map(([name]) => name), ["unenroll", "enroll"]);
  assert.deepEqual(c.calls[0][1], { factorId: "pending" });
});
test("restart refuses to remove a verified authenticator", async () => {
  const c = client({ factors: [{ id: "verified", factor_type: "totp", status: "verified", friendly_name: "FlowPay authenticator" }] });
  await assert.rejects(createMfaController(c).restartUnverifiedEnrollment(), /unavailable/);
  assert.equal(c.calls.length, 0);
});
test("restart refuses ambiguous pending enrollments", async () => {
  const c = client({ factors: [
    { id: "a", factor_type: "totp", status: "unverified", friendly_name: "FlowPay authenticator" },
    { id: "b", factor_type: "totp", status: "unverified", friendly_name: "FlowPay authenticator" }
  ] });
  await assert.rejects(createMfaController(c).restartUnverifiedEnrollment(), /single unfinished/);
  assert.equal(c.calls.length, 0);
});

test("signed-out user cannot enroll a factor", async () => {
  const c = client({ session: false });
  await assert.rejects(createMfaController(c).enroll(), /Sign in/);
  assert.equal(c.calls.length, 0);
});
test("AAL1 session cannot add another factor to an account with verified MFA", async () => {
  const c = client({ factors: [{ id: "one", status: "verified" }] });
  await assert.rejects(createMfaController(c).enroll(), /Verify your existing authenticator/);
  assert.equal(c.calls.length, 0);
});
test("AAL2 session can add a backup authenticator without removing the original", async () => {
  const c = client({ level: "aal2", factors: [{ id: "one", status: "verified" }] });
  assert.equal((await createMfaController(c).enroll("Backup authenticator")).factorId, "new");
  assert.deepEqual(c.calls, [["enroll", { factorType: "totp", friendlyName: "Backup authenticator" }]]);
});

test("verified account can restart only its unfinished backup authenticator", async () => {
  const c = client({ level: "aal2", factors: [
    { id: "original", status: "verified", friendly_name: "FlowPay authenticator" },
    { id: "pending-backup", status: "unverified", friendly_name: "FlowPay backup authenticator" }
  ] });
  assert.equal((await createMfaController(c).restartUnverifiedBackupEnrollment()).factorId, "new");
  assert.deepEqual(c.calls, [
    ["unenroll", { factorId: "pending-backup" }],
    ["enroll", { factorType: "totp", friendlyName: "FlowPay backup authenticator" }]
  ]);
});
test("AAL1 cannot restart a backup authenticator", async () => {
  const c = client({ factors: [
    { id: "original", status: "verified" },
    { id: "pending-backup", status: "unverified", friendly_name: "FlowPay backup authenticator" }
  ] });
  await assert.rejects(createMfaController(c).restartUnverifiedBackupEnrollment(), /MFA verification required/);
  assert.deepEqual(c.calls, []);
});
