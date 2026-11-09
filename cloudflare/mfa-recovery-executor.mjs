import { validateMfaRecoveryCase } from "./mfa-recovery-policy.mjs";

// Privileged recovery executor. Never import this module into a browser bundle.
// No network action is possible without a separately supplied privileged client.
// The caller must provide an append-only, externally persisted audit writer.
export async function executeMfaRecovery({
  record, admin, audit, getVerifiedFactors, verifyTrustedCase, claimRecoveryCase, verifySessionsRevoked, now = Date.now(),
  dryRun = true
}) {
  // Snapshot untrusted input before any awaited call. A caller must not be able
  // to mutate the approved user, factor list, or approvals mid-operation.
  const submitted = structuredClone(record);
  const validation = validateMfaRecoveryCase(submitted, { now });
  if (!validation.approved) {
    return { status: "denied", errors: validation.errors };
  }
  if (typeof getVerifiedFactors !== "function" || typeof audit !== "function" ||
      typeof verifyTrustedCase !== "function" || typeof claimRecoveryCase !== "function" ||
      typeof verifySessionsRevoked !== "function") {
    throw new Error("Trusted case verification, atomic case claim, session revocation verification, factor lookup and durable audit writer required");
  }
  // Approval flags supplied in a request are not proof of independent authorization.
  // The trusted verifier must independently validate case ownership, identity evidence,
  // operator and both approvals against authoritative records.
  const trusted = await verifyTrustedCase(structuredClone(submitted));
  if (trusted !== true) throw new Error("Recovery case not independently authorized");
  const verified = await getVerifiedFactors(submitted.userId);
  if (!Array.isArray(verified) || verified.some(f => !f || typeof f.id !== "string")) {
    throw new Error("Trusted factor inventory unavailable");
  }
  const verifiedIds = new Set(verified.filter(f => f.status === "verified").map(f => f.id));
  if (!submitted.factorIds.every(id => verifiedIds.has(id))) {
    throw new Error("Requested factor does not match verified inventory");
  }
  // Do not permit a partial factor reset: all verified factors must be explicitly approved.
  if (submitted.factorIds.length !== verifiedIds.size ||
      ![...verifiedIds].every(id => submitted.factorIds.includes(id))) {
    throw new Error("Recovery must explicitly authorize every verified factor");
  }
  const metadata = {
    caseId: submitted.caseId, userId: submitted.userId,
    factorIds: [...submitted.factorIds], operatorId: submitted.operatorId,
    approverIds: submitted.approvals.map(a => a.approverId)
  };
  if (dryRun) return { status: "dry-run", ...metadata };
  if (typeof admin?.auth?.admin?.mfa?.deleteFactor !== "function") {
    throw new Error("Privileged Supabase admin MFA client required");
  }
  // Recheck immediately before the first destructive operation. This reduces
  // stale-inventory risk but is NOT an atomic lock against concurrent changes.
  const current = await getVerifiedFactors(submitted.userId);
  if (!Array.isArray(current) || current.some(f => !f || typeof f.id !== "string")) {
    throw new Error("Trusted factor inventory unavailable at execution");
  }
  const currentIds = current.filter(f => f.status === "verified").map(f => f.id);
  if (currentIds.length !== submitted.factorIds.length ||
      !currentIds.every(id => submitted.factorIds.includes(id))) {
    throw new Error("Verified factor inventory changed before execution");
  }
  // The case store must atomically claim this case exactly once (durable compare-and-set).
  // A plain read followed by write is NOT sufficient across concurrent operators.
  const claimed = await claimRecoveryCase(metadata);
  if (claimed !== true) throw new Error("Recovery case already claimed or unavailable");
  // The audit sink must durably record intent before any irreversible mutation.
  await audit({ event: "mfa_recovery_started", ...metadata });
  const deleted = [];
  try {
    for (const id of submitted.factorIds) {
      const result = await admin.auth.admin.mfa.deleteFactor({ userId: submitted.userId, id });
      if (result?.error) throw result.error;
      deleted.push(id);
      await audit({ event: "mfa_factor_deleted", caseId: submitted.caseId, userId: submitted.userId, factorId: id });
    }
    const after = await getVerifiedFactors(submitted.userId);
    if (!Array.isArray(after) || after.some(f => !f || typeof f.id !== "string") ||
        after.some(f => f.status === "verified" && submitted.factorIds.includes(f.id))) {
      throw new Error("MFA recovery factor deletion could not be verified");
    }
    // Supabase deletes verified factors and signs out sessions, but signed JWTs
    // may remain valid until expiry unless the API checks server-side session state.
    if (await verifySessionsRevoked(submitted.userId) !== true) {
      throw new Error("MFA recovery session revocation could not be verified");
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
