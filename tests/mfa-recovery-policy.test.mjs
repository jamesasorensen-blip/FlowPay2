import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMfaRecoveryCase} from '../cloudflare/mfa-recovery-policy.mjs';
const now=Date.parse('2026-11-10T12:00:00Z');
const u='0b2cf21b-5147-4337-b73d-fbba9f1a514d';
const factor='e25d68bc-3c52-4f90-a7b1-bb21c7a0f151';
const baseline=()=>({
 caseId:'case-001',userId:u,identityEvidenceRef:'verified-identity-001',
 identityVerified:true,identityMethod:'prior-established-proof',
 operatorId:'staff-operator',factorIds:[factor],
 approvals:[
 {approverId:'staff-reviewer-one',approved:true,evidenceRef:'review-evidence-one',approvedAt:'2026-11-10T11:00:00Z'},
 {approverId:'staff-reviewer-two',approved:true,evidenceRef:'review-evidence-two',approvedAt:'2026-11-10T11:00:00Z'}
 ],status:'pending_approval',requestedAt:'2026-11-07T10:00:00Z',
 revokeAllSessions:true,requireFreshMfaEnrollment:true,
 userNotified:true,notificationRef:'notification-record-001',
 confirmedNoUsableBackupFactor:true
});
test('fully documented two-reviewer recovery passes preflight',()=>{
 assert.equal(validateMfaRecoveryCase(baseline(),{now}).approved,true);
});
for(const [name,mutate] of [
 ['waiting period',x=>x.requestedAt='2026-11-09T10:00:00Z'],
 ['cancellation',x=>x.cancelledAt='2026-11-09T11:00:00Z'],
 ['suspicious request',x=>x.suspiciousActivity=true],
 ['duplicate reviewer',x=>x.approvals[1].approverId=x.approvals[0].approverId],
 ['missing notification',x=>x.userNotified=false],
 ['email-only verification',x=>x.identityMethod='email-only'],
 ['no session revocation',x=>x.revokeAllSessions=false],
 ['no reenrollment',x=>x.requireFreshMfaEnrollment=false],
 ['missing backup check',x=>x.confirmedNoUsableBackupFactor=false]
]){
 test('recovery fails closed for '+name,()=>{
  const x=baseline();mutate(x);
  assert.equal(validateMfaRecoveryCase(x,{now}).approved,false);
 });
}
