import { validateMfaRecoveryCase } from "./mfa-recovery-policy.mjs";

// Privileged recovery executor. Never import this module into a browser bundle.
// No network action is possible without a separately supplied privileged client.
// The caller must provide an append-only, externally persisted audit writer.
export async function executeMfaRecovery({
  record, admin, audit, getVerifiedFactors, verifyTrustedCase, now = Date.now(),
  dryRun = true
}) {
  const validation = validateMfaRecoveryCase(record, { now });
  if (!validation.approved) {
    return { status: "denied", errors: validation.errors };
  }
  if (typeof getVerifiedFactors !== "function" || typeof audit !== "function" ||
      typeof verifyTrustedCase !== "function") {
    throw new Error("Trusted case verification, factor lookup and durable audit writer required");
  }
  // Approval flags supplied in a request are not proof of independent authorization.
  // The trusted verifier must independently validate case ownership, identity evidence,
  // operator and both approvals against authoritative records.
  const trusted = await verifyTrustedCase(record);
  if (trusted !== true) throw new Error("Recovery case not independently authorized");
  const verified = await getVerifiedFactors(record.userId);
  if (!Array.isArray(verified) || verified.some(f => !f || typeof f.id !== "string")) {
    throw new Error("Trusted factor inventory unavailable");
  }
  const verifiedIds = new Set(verified.filter(f => f.status === "verified").map(f => f.id));
  if (!record.factorIds.every(id => verifiedIds.has(id))) {
    throw new Error("Requested factor does not match verified inventory");
  }
  // Do not permit a partial factor reset: all verified factors must be explicitly approved.
  if (record.factorIds.length !== verifiedIds.size ||
      ![...verifiedIds].every(id => record.factorIds.includes(id))) {
    throw new Error("Recovery must explicitly authorize every verified factor");
  }
  const metadata = {
    caseId: record.caseId, userId: record.userId,
    factorIds: [...record.factorIds], operatorId: record.operatorId,
    approverIds: record.approvals.map(a => a.approverId)
  };
  if (dryRun) return { status: "dry-run", ...metadata };
  if (typeof admin?.auth?.admin?.mfa?.deleteFactor !== "function") {
    throw new Error("Privileged Supabase admin MFA client required");
  }
  // Recheck immediately before the first destructive operation. This reduces
  // stale-inventory risk but is NOT an atomic lock against concurrent changes.
  const current = await getVerifiedFactors(record.userId);
  if (!Array.isArray(current) || current.some(f => !f || typeof f.id !== "string")) {
    throw new Error("Trusted factor inventory unavailable at execution");
  }
  const currentIds = current.filter(f => f.status === "verified").map(f => f.id);
  if (currentIds.length !== record.factorIds.length ||
      !currentIds.every(id => record.factorIds.includes(id))) {
    throw new Error("Verified factor inventory changed before execution");
  }
  // The audit sink must durably record intent before any irreversible mutation.
  await audit({ event: "mfa_recovery_started", ...metadata });
  const deleted = [];
  try {
    for (const id of record.factorIds) {
      const result = await admin.auth.admin.mfa.deleteFactor({ userId: record.userId, id });
      if (result?.error) throw result.error;
      deleted.push(id);
      await audit({ event: "mfa_factor_deleted", caseId: record.caseId, userId: record.userId, factorId: id });
    }
    await audit({ event: "mfa_recovery_completed", ...metadata });
  } catch (error) {
    // Fail visibly. Never retry automatically after a partial destructive operation.
    try {
      await audit({ event: "mfa_recovery_failed", ...metadata, deletedFactorIds: deleted, errorCode: "OPERATION_FAILED" });
    } catch {
      throw new Error("Recovery failed and audit logging also failed; escalate immediately");
    }
    throw error;
  }
  return { status: "completed", ...metadata, deletedFactorIds: deleted };
}
