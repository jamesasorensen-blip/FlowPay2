import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMfaRecoveryCase} from '../mfa-recovery-policy.mjs';
import {executeMfaRecovery} from '../mfa-recovery-executor.mjs';
const now=Date.parse('2026-11-09T20:00:00Z');
const user='00000000-0000-4000-8000-000000000001',factor='00000000-0000-4000-8000-000000000002';
const owner='owner-control-plane';
const policy=()=>({mode:'owner',ownerOperatorId:owner});
const record=()=>({caseId:'case-123456',userId:user,operatorId:owner,identityEvidenceRef:'evidence-001',identityVerified:true,identityMethod:'verified-callback',factorIds:[factor],confirmedNoUsableBackupFactor:true,userNotified:true,notificationRef:'notice-001',status:'pending_approval',requestedAt:'2026-11-07T10:00:00Z',revokeAllSessions:true,requireFreshMfaEnrollment:true,approvals:[{approverId:owner,approved:true,evidenceRef:'approval-001',approvedAt:'2026-11-09T19:00:00Z'}]});
function harness(){
 const events=[],deletes=[],trusted=[];
 return {events,deletes,trusted,
  verifyOwnerAuthority:async input=>input.ownerOperatorId===owner,
  verifyTrustedCase:async(r,p)=>{trusted.push(p);return true;},
  claimRecoveryCase:async()=>true,verifySessionsRevoked:async()=>true,
  getVerifiedFactors:async()=>deletes.length?[]:[{id:factor,status:'verified'}],
  audit:async event=>{events.push(event);},
  admin:{auth:{admin:{mfa:{deleteFactor:async input=>{deletes.push(input);return {data:{}};}}}}}
 };
}
test('trusted owner mode accepts exactly the configured owner approval',()=>{
 assert.deepEqual(validateMfaRecoveryCase(record(),{now,...policy()}),{approved:true,errors:[]});
});
test('body fields cannot opt into owner mode or nominate a new owner',()=>{
 assert.equal(validateMfaRecoveryCase({...record(),mode:'owner',ownerOperatorId:owner},{now}).approved,false);
 for(const p of [{mode:'owner'},{mode:'owner',ownerOperatorId:'another-owner'},{mode:'unknown',ownerOperatorId:owner}])assert.equal(validateMfaRecoveryCase(record(),{now,...p}).approved,false);
});
test('wrong operator, missing/extra/foreign approval and stale approval fail closed',()=>{
 for(const patch of [{operatorId:'another-owner'},{approvals:[]},{approvals:[...record().approvals,...record().approvals]},{approvals:[{...record().approvals[0],approverId:'another-owner'}]},{approvals:[{...record().approvals[0],approvedAt:'2026-11-07T10:00:00Z'}]}])assert.equal(validateMfaRecoveryCase({...record(),...patch},{now,...policy()}).approved,false);
});
test('owner mode retains independent verification, waiting, notice and re-enrollment controls',()=>{
 for(const patch of [{identityVerified:false},...['email-only','password-only','flowpay-session-only'].map(identityMethod=>({identityMethod})),{requestedAt:'2026-11-09T19:00:00Z'},{userNotified:false},{confirmedNoUsableBackupFactor:false},{revokeAllSessions:false},{requireFreshMfaEnrollment:false},{cancelledAt:'2026-11-09T19:00:00Z'}])assert.equal(validateMfaRecoveryCase({...record(),...patch},{now,...policy()}).approved,false);
});
test('missing or rejected independent owner authentication stops before inventory access',async()=>{
 for(const verifyOwnerAuthority of [undefined,async()=>false]){
  const h=harness();h.getVerifiedFactors=async()=>{throw Error('inventory must not be read');};
  await assert.rejects(executeMfaRecovery({record:record(),policy:policy(),...h,verifyOwnerAuthority,now,dryRun:false}),/app-owner authority/);
  assert.equal(h.deletes.length,0);
 }
});
test('owner authority does not replace trusted case verification',async()=>{
 const h=harness();h.verifyTrustedCase=async()=>false;
 await assert.rejects(executeMfaRecovery({record:record(),policy:policy(),...h,now,dryRun:false}),/independently authorized/);
 assert.equal(h.deletes.length,0);
});
test('owner dry-run performs no claim, audit or deletion',async()=>{
 const h=harness();h.claimRecoveryCase=async()=>{throw Error('must not claim dry-run');};
 const r=await executeMfaRecovery({record:record(),policy:policy(),...h,now});
 assert.equal(r.status,'dry-run');assert.equal(r.recoveryMode,'owner');assert.equal(h.events.length,0);assert.equal(h.deletes.length,0);
});
test('mock owner execution audits before deletion and verifies revocation',async()=>{
 const h=harness();let verified=false;h.verifySessionsRevoked=async()=>{verified=true;return true;};
 const r=await executeMfaRecovery({record:record(),policy:policy(),...h,now,dryRun:false});
 assert.equal(r.status,'completed');assert.equal(verified,true);assert.deepEqual(h.deletes,[{userId:user,id:factor}]);
 assert.deepEqual(h.events.map(e=>e.event),['mfa_recovery_started','mfa_factor_deleted','mfa_recovery_completed']);
 assert.equal(h.events[0].recoveryMode,'owner');
});
test('owner execution cannot proceed without durable intent or a one-time case claim',async()=>{
 for(const patch of [{audit:async()=>{throw Error('audit unavailable');}},{claimRecoveryCase:async()=>false}]){
  const h={...harness(),...patch};await assert.rejects(executeMfaRecovery({record:record(),policy:policy(),...h,now,dryRun:false}));assert.equal(h.deletes.length,0);
 }
});
test('trusted configuration is snapshotted across asynchronous owner verification',async()=>{
 const h=harness(),p=policy();h.verifyOwnerAuthority=async()=>{p.ownerOperatorId='changed-owner';p.mode='changed-mode';return true;};
 const r=await executeMfaRecovery({record:record(),policy:p,...h,now});
 assert.equal(r.recoveryMode,'owner');assert.deepEqual(h.trusted,[policy()]);
});
