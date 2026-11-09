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
    claimRecoveryCase: async () => true,
    verifySessionsRevoked: async () => true,
    getVerifiedFactors: async () => deletes.some(d => d.id === uuid(2)) ? [] : [{ id: uuid(2), status: "verified" }],
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

test("inventory drift after approval but before execution blocks deletion", async () => {
  const h = harness();
  let calls = 0;
  h.getVerifiedFactors = async () => {
    calls += 1;
    return calls === 1
      ? [{ id: uuid(2), status: "verified" }]
      : [{ id: uuid(2), status: "verified" }, { id: uuid(3), status: "verified" }];
  };
  await assert.rejects(executeMfaRecovery({ record: record(), ...h, now, dryRun: false }), /inventory changed/);
  assert.equal(h.deletes.length, 0);
  assert.equal(h.events.length, 0);
});

test("partial deletion halts immediately and records failure", async () => {
  const h = harness();
  const r = record();
  r.factorIds = [uuid(2), uuid(3)];
  h.getVerifiedFactors = async () => [
    { id: uuid(2), status: "verified" }, { id: uuid(3), status: "verified" }
  ];
  let count = 0;
  h.admin.auth.admin.mfa.deleteFactor = async input => {
    h.deletes.push(input);
    count++;
    return count === 2 ? { error: new Error("Supabase rejected deletion") } : { data: {} };
  };
  await assert.rejects(executeMfaRecovery({ record: r, ...h, now, dryRun: false }), /Supabase rejected deletion/);
  assert.equal(h.deletes.length, 2);
  assert.deepEqual(h.events.map(e => e.event), [
    "mfa_recovery_started", "mfa_factor_deleted", "mfa_recovery_failed"
  ]);
  assert.deepEqual(h.events.at(-1).deletedFactorIds, [uuid(2)]);
});
test("audit failure after first deletion prevents further deletions", async () => {
  const h = harness();
  const r = record();
  r.factorIds = [uuid(2), uuid(3)];
  h.getVerifiedFactors = async () => [
    { id: uuid(2), status: "verified" }, { id: uuid(3), status: "verified" }
  ];
  h.audit = async event => {
    if (event.event === "mfa_factor_deleted") throw new Error("audit unavailable");
    h.events.push(event);
  };
  await assert.rejects(executeMfaRecovery({ record: r, ...h, now, dryRun: false }), /audit unavailable/);
  assert.equal(h.deletes.length, 1);
  assert.equal(h.events.at(-1).event, "mfa_recovery_failed");
});

test("a replayed recovery case cannot delete factors twice", async () => {
  const h = harness();
  let claimed = false;
  h.claimRecoveryCase = async () => {
    if (claimed) return false;
    claimed = true;
    return true;
  };
  const first = await executeMfaRecovery({ record: record(), ...h, now, dryRun: false });
  assert.equal(first.status, "completed");
  await assert.rejects(executeMfaRecovery({ record: record(), ...h, now, dryRun: false }), /already claimed|verified inventory/);
  assert.equal(h.deletes.length, 1);
});
test("missing atomic case claim blocks all privileged operations", async () => {
  const h = harness();
  delete h.claimRecoveryCase;
  await assert.rejects(executeMfaRecovery({ record: record(), ...h, now, dryRun: false }), /atomic case claim/);
  assert.equal(h.deletes.length, 0);
});

test("does not report success when Supabase returns success but factor remains", async () => {
  const h = harness();
  h.getVerifiedFactors = async () => [{ id: uuid(2), status: "verified" }];
  await assert.rejects(executeMfaRecovery({ record: record(), ...h, now, dryRun: false }), /could not be verified/);
  assert.equal(h.deletes.length, 1);
  assert.equal(h.events.at(-1).event, "mfa_recovery_failed");
  assert.equal(h.events.some(e => e.event === "mfa_recovery_completed"), false);
});

test("caller cannot swap authorized factor while trusted verification is pending", async () => {
  const h = harness();
  const r = record();
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  h.verifyTrustedCase = async () => { await waiting; return true; };
  const pending = executeMfaRecovery({ record: r, ...h, now, dryRun: false });
  r.factorIds[0] = uuid(3);
  r.userId = uuid(4);
  release();
  const result = await pending;
  assert.equal(result.status, "completed");
  assert.deepEqual(h.deletes, [{ userId: uuid(1), id: uuid(2) }]);
});
test("trusted verifier cannot mutate the approved recovery snapshot", async () => {
  const h = harness();
  h.verifyTrustedCase = async r => {
    r.factorIds[0] = uuid(3);
    r.userId = uuid(4);
    return true;
  };
  const result = await executeMfaRecovery({ record: record(), ...h, now, dryRun: false });
  assert.equal(result.status, "completed");
  assert.deepEqual(h.deletes, [{ userId: uuid(1), id: uuid(2) }]);
});

test("session revocation must be independently confirmed before recovery completion", async () => {
  const h = harness();
  h.verifySessionsRevoked = async () => false;
  await assert.rejects(executeMfaRecovery({ record: record(), ...h, now, dryRun: false }), /session revocation could not be verified/);
  assert.equal(h.deletes.length, 1);
  assert.equal(h.events.at(-1).event, "mfa_recovery_failed");
  assert.equal(h.events.some(e => e.event === "mfa_recovery_completed"), false);
});
test("missing session revocation verifier blocks destructive recovery", async () => {
  const h = harness();
  delete h.verifySessionsRevoked;
  await assert.rejects(executeMfaRecovery({ record: record(), ...h, now, dryRun: false }), /session revocation verification/);
  assert.equal(h.deletes.length, 0);
});

test("recovery fails if a newly enrolled verified factor appears after deletion", async () => {
  const h = harness();
  let inventoryCalls = 0;
  h.getVerifiedFactors = async () => {
    inventoryCalls += 1;
    if (inventoryCalls < 3) return [{ id: uuid(2), status: "verified" }];
    return [{ id: uuid(3), status: "verified" }];
  };
  await assert.rejects(
    executeMfaRecovery({ record: record(), ...h, now, dryRun: false }),
    /factor deletion could not be verified/
  );
  assert.equal(h.deletes.length, 1);
  assert.equal(h.events.at(-1).event, "mfa_recovery_failed");
  assert.equal(h.events.some(e => e.event === "mfa_recovery_completed"), false);
});

test("null Supabase deletion response is not treated as success", async () => {
  const h = harness();
  h.admin.auth.admin.mfa.deleteFactor = async input => {
    h.deletes.push(input);
    return null;
  };
  await assert.rejects(
    executeMfaRecovery({ record: record(), ...h, now, dryRun: false }),
    /did not confirm MFA factor deletion/
  );
  assert.equal(h.events.at(-1).event, "mfa_recovery_failed");
  assert.equal(h.events.some(e => e.event === "mfa_recovery_completed"), false);
});
test("replayed recovery case fails atomic claim even if factors still appear present", async () => {
  const h = harness();
  h.getVerifiedFactors = async () => [{ id: uuid(2), status: "verified" }];
  let claimed = false;
  h.claimRecoveryCase = async () => {
    if (claimed) return false;
    claimed = true;
    return true;
  };
  await assert.rejects(
    executeMfaRecovery({ record: record(), ...h, now, dryRun: false }),
    /factor deletion could not be verified/
  );
  const deletions = h.deletes.length;
  await assert.rejects(
    executeMfaRecovery({ record: record(), ...h, now, dryRun: false }),
    /already claimed/
  );
  assert.equal(h.deletes.length, deletions);
});
