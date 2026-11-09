import test from "node:test";
import assert from "node:assert/strict";
import { validateMfaRecoveryCase } from "../mfa-recovery-policy.mjs";
const now = Date.parse("2026-11-09T20:00:00Z");
const uuid = n => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const valid = () => ({
  caseId: "case-123456", userId: uuid(1), operatorId: "operator-001",
  identityEvidenceRef: "evidence-001", identityVerified: true,
  identityMethod: "verified-callback", factorIds: [uuid(2)],
  confirmedNoUsableBackupFactor: true, userNotified: true, notificationRef: "notice-001",
  approvals: [
    { approverId: "reviewer-001", approved: true, evidenceRef: "approval-001", approvedAt: "2026-11-09T19:00:00Z" },
    { approverId: "reviewer-002", approved: true, evidenceRef: "approval-002", approvedAt: "2026-11-09T19:10:00Z" }
  ]
});
test("valid independently verified recovery case passes preflight", () => {
  assert.deepEqual(validateMfaRecoveryCase(valid(), { now }), { approved: true, errors: [] });
});
test("incomplete or fraudulent recovery requests fail closed", () => {
  const cases = [
    null, {}, { ...valid(), approvals: [valid().approvals[0]] },
    { ...valid(), approvals: [valid().approvals[0], valid().approvals[0]] },
    { ...valid(), operatorId: "reviewer-001" },
    { ...valid(), identityVerified: false },
    { ...valid(), identityMethod: "email-only" },
    { ...valid(), factorIds: [uuid(2), uuid(2)] },
    { ...valid(), factorIds: [] },
    { ...valid(), userNotified: false },
    { ...valid(), confirmedNoUsableBackupFactor: false },
    { ...valid(), approvals: valid().approvals.map(a => ({ ...a, approvedAt: "2026-11-07T10:00:00Z" })) },
    { ...valid(), approvals: valid().approvals.map(a => ({ ...a, approvedAt: "2026-11-10T10:00:00Z" })) }
  ];
  for (const record of cases) {
    assert.equal(validateMfaRecoveryCase(record, { now }).approved, false, JSON.stringify(record));
  }
});
