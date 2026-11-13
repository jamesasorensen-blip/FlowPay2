// Server-only PostgreSQL adapter. Never import into browser bundles. query must
// use the dedicated owner-bound DB login; separate control-plane authentication
// still belongs in executeMfaRecovery.verifyOwnerAuthority.
import {validateMfaRecoveryCase} from './mfa-recovery-policy.mjs';

function canonical(record) {
  const time=value=>Date.parse(value);
  return JSON.stringify([
    record.caseId,record.userId,record.operatorId,[...record.factorIds].sort(),
    record.identityVerified,record.identityMethod,record.identityEvidenceRef,
    time(record.requestedAt),record.status,record.confirmedNoUsableBackupFactor,
    record.userNotified,record.notificationRef,record.revokeAllSessions,
    record.requireFreshMfaEnrollment,record.suspiciousActivity===true,record.cancelledAt||null,
    record.approvals.map(a=>[a.approverId,a.approved,a.evidenceRef,time(a.approvedAt)]).sort()
  ]);
}

export async function createOwnerRecoveryStore({query,ownerOperatorId,now=Date.now}) {
  if(typeof query!=='function'||typeof ownerOperatorId!=='string')throw Error('Trusted owner database configuration required');
  const binding=await query('select flowpay_owner_recovery_private.current_owner() as principal',[]);
  if(binding?.rows?.[0]?.principal!==ownerOperatorId)throw Error('Database owner binding mismatch');
  const policy=Object.freeze({mode:'owner',ownerOperatorId});
  const one=async(text,params,column)=>{
    const result=await query(text,params);
    if(!Array.isArray(result?.rows)||result.rows.length!==1)throw Error('Recovery store unavailable');
    return result.rows[0][column];
  };
  const loadCase=caseId=>one('select flowpay_owner_recovery_private.read_case($1::uuid) as record',[caseId],'record');
  return {
    policy,
    loadCase,
    openCase:input=>one('select flowpay_owner_recovery_private.open_case($1::uuid,$2::uuid[],$3::text,$4::text,$5::text,$6::boolean) as case_id',[
      input.userId,input.factorIds,input.identityMethod,input.identityEvidenceRef,input.notificationRef,input.confirmedNoUsableBackupFactor
    ],'case_id'),
    approveCase:(caseId,evidenceRef)=>one('select flowpay_owner_recovery_private.approve_case($1::uuid,$2::text) as result',[caseId,evidenceRef],'result'),
    cancelCase:caseId=>one('select flowpay_owner_recovery_private.cancel_case($1::uuid) as changed',[caseId],'changed'),
    async verifyTrustedCase(submitted,requestedPolicy) {
      if(requestedPolicy?.mode!=='owner'||requestedPolicy.ownerOperatorId!==ownerOperatorId)return false;
      const authoritative=await loadCase(submitted.caseId);
      if(!validateMfaRecoveryCase(authoritative,{...policy,now:now()}).approved)return false;
      try{return canonical(authoritative)===canonical(submitted);}catch{return false;}
    },
    async claimRecoveryCase(metadata) {
      if(metadata?.recoveryMode!=='owner'||metadata.operatorId!==ownerOperatorId||
          metadata.approverIds?.length!==1||metadata.approverIds[0]!==ownerOperatorId)return false;
      return await one('select flowpay_owner_recovery_private.claim_case($1::uuid,$2::uuid,$3::uuid[]) as claimed',[
        metadata.caseId,metadata.userId,metadata.factorIds
      ],'claimed')===true;
    },
    async audit(event) {
      await one('select flowpay_owner_recovery_private.append_event($1::uuid,$2::text,$3::uuid,$4::text) as result',[
        event.caseId,event.event,event.factorId||null,event.errorCode||null
      ],'result');
    }
  };
}
