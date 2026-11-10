// Fail-closed preflight for a privileged, out-of-band MFA recovery operation.
// This module never calls Supabase or handles privileged credentials.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[a-zA-Z0-9._:-]{6,128}$/;
const evidence = value => typeof value === "string" && ID.test(value);
export function validateMfaRecoveryCase(record, { now = Date.now() } = {}) {
  const errors = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { approved: false, errors: ["Recovery case required"] };
  }
  if (!evidence(record.caseId)) errors.push("Valid case ID required");
  if (typeof record.userId !== "string" || !UUID.test(record.userId)) errors.push("Valid target user ID required");
  if (!evidence(record.identityEvidenceRef) || record.identityVerified !== true ||
      record.identityMethod === "email-only" || !evidence(record.identityMethod)) {
    errors.push("Independent identity verification required");
  }
  if (!evidence(record.operatorId)) errors.push("Operator ID required");
  if (!Array.isArray(record.factorIds) || record.factorIds.length === 0 ||
      record.factorIds.some(id => typeof id !== "string" || !UUID.test(id)) ||
      new Set(record.factorIds).size !== record.factorIds.length) {
    errors.push("Unique verified factor IDs required");
  }
  const approvals = record.approvals;
  if (!Array.isArray(approvals) || approvals.length !== 2) {
    errors.push("Exactly two independent approvals required");
  } else {
    const ids = approvals.map(a => a?.approverId);
    if (ids.some(id => !evidence(id)) || ids[0] === ids[1] || ids.includes(record.operatorId)) {
      errors.push("Approvers must be distinct and independent of operator");
    }
    if (approvals.some(a => a?.approved !== true || !evidence(a?.evidenceRef))) {
      errors.push("Documented affirmative approval required");
    }
    if (approvals.some(a => typeof a?.approvedAt !== "string" ||
      !Number.isFinite(Date.parse(a.approvedAt)) || Date.parse(a.approvedAt) > now ||
      now - Date.parse(a.approvedAt) > 24 * 60 * 60 * 1000)) {
      errors.push("Approvals must be valid and less than 24 hours old");
    }
  }
  if (record.status !== "pending_approval" || record.cancelledAt || record.suspiciousActivity === true) {
    errors.push("Recovery case must be pending and not cancelled or escalated");
  }
  const requestedAt = Date.parse(record.requestedAt);
  if (!Number.isFinite(requestedAt) || requestedAt > now ||
      now - requestedAt < 48 * 60 * 60 * 1000) {
    errors.push("48-hour recovery waiting period required");
  }
  if (record.revokeAllSessions !== true || record.requireFreshMfaEnrollment !== true) {
    errors.push("Session revocation and MFA re-enrollment required");
  }
  if (record.userNotified !== true || !evidence(record.notificationRef)) {
    errors.push("Documented recovery notification required");
  }
  if (record.confirmedNoUsableBackupFactor !== true) {
    errors.push("Confirm no usable backup factor before reset");
  }
  return { approved: errors.length === 0, errors };
}
