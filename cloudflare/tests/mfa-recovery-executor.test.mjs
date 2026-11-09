import test from "node:test";
import assert from "node:assert/strict";
import { executeMfaRecovery } from "../mfa-recovery-executor.mjs";
const now = Date.parse("2026-11-09T20:00:00Z");
const uuid = n => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const record = () => ({
  caseId: "case-123456", userId: uuid(1), operatorId: "operator-001",
  identityEvidenceRef: "evidence-001", identityVerified: true,
  identityMethod: "verified-callback", factorIds: [uuid(2)],
  confirmedNoUsableBackupFactor: true, userNotified: true, notificationRef: "notice-001",
  approvals: [
    { approverId: "reviewer-001", approved: true, evidenceRef: "approval-001", approvedAt: "2026-11-09T19:00:00Z" },
    { approverId: "reviewer-002", approved: true, evidenceRef: "approval-002", approvedAt: "2026-11-09T19:10:00Z" }
  ]
});
function harness() {
  const events = [], deletes = [];
  return {
    events, deletes,
    audit: async e => { events.push(e); },
    verifyTrustedCase: async () => true,
    getVerifiedFactors: async () => [{ id: uuid(2), status: "verified" }],
    admin: { auth: { admin: { mfa: { deleteFactor: async input => {
      deletes.push(input); return { data: {} };
    } } } } }
  };
}
test("dry-run validates inventory and never deletes", async () => {
  const h = harness();
  const result = await executeMfaRecovery({ record: record(), ...h, now });
  assert.equal(result.status, "dry-run");
  assert.equal(h.deletes.length, 0);
  assert.equal(h.events.length, 0);
});
test("approved execution writes intent before privileged deletion", async () => {
  const h = harness();
  const result = await executeMfaRecovery({ record: record(), ...h, now, dryRun: false });
  assert.equal(result.status, "completed");
  assert.deepEqual(h.deletes, [{ userId: uuid(1), id: uuid(2) }]);
  assert.deepEqual(h.events.map(e => e.event), ["mfa_recovery_started", "mfa_factor_deleted", "mfa_recovery_completed"]);
});
test("single approval and wrong factor are rejected", async () => {
  const h = harness();
  const denied = await executeMfaRecovery({ record: { ...record(), approvals: [record().approvals[0]] }, ...h, now, dryRun: false });
  assert.equal(denied.status, "denied");
  await assert.rejects(executeMfaRecovery({ record: { ...record(), factorIds: [uuid(3)] }, ...h, now, dryRun: false }), /inventory/);
  assert.equal(h.deletes.length, 0);
});
test("audit failure prevents privileged deletion", async () => {
  const h = harness();
  h.audit = async () => { throw new Error("audit offline"); };
  await assert.rejects(executeMfaRecovery({ record: record(), ...h, now, dryRun: false }), /audit offline/);
  assert.equal(h.deletes.length, 0);
});

test("self-attested approvals without trusted verification cannot reset factors", async () => {
  const h = harness();
  h.verifyTrustedCase = async () => false;
  await assert.rejects(executeMfaRecovery({ record: record(), ...h, now, dryRun: false }), /independently authorized/);
  assert.equal(h.deletes.length, 0);
  assert.equal(h.events.length, 0);
});
test("missing trusted verifier fails closed before any deletion", async () => {
  const h = harness();
  delete h.verifyTrustedCase;
  await assert.rejects(executeMfaRecovery({ record: record(), ...h, now, dryRun: false }), /Trusted case verification/);
  assert.equal(h.deletes.length, 0);
});

test("refuses partial reset when another verified factor exists", async () => {
  const h = harness();
  h.getVerifiedFactors = async () => [
    { id: uuid(2), status: "verified" },
    { id: uuid(3), status: "verified" }
  ];
  await assert.rejects(executeMfaRecovery({ record: record(), ...h, now, dryRun: false }), /every verified factor/);
  assert.equal(h.deletes.length, 0);
});
test("rejects inventory that includes an unverified or wrong factor", async () => {
  const h = harness();
  h.getVerifiedFactors = async () => [{ id: uuid(2), status: "unverified" }];
  await assert.rejects(executeMfaRecovery({ record: record(), ...h, now, dryRun: false }), /verified inventory/);
  assert.equal(h.deletes.length, 0);
});
