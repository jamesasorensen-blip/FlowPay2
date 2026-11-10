import test from 'node:test';
import assert from 'node:assert/strict';
import { createMfaController } from '../cloudflare/flowpay-mfa.mjs';

function client({aal='aal2', verified=['primary','backup'], pending=[]}={}) {
  const calls=[];
  const factors=verified.map(id=>({id,status:'verified',factor_type:'totp'}));
  const unverified=pending.map(id=>({id,status:'unverified',factor_type:'totp',friendly_name:'FlowPay backup authenticator'}));
  const ok=data=>Promise.resolve({data,error:null});
  const auth={
    getSession:()=>ok({session:{access_token:'test-only'}}),
    mfa:{
      listFactors:()=>ok({totp:[...factors,...unverified],all:[...factors,...unverified]}),
      getAuthenticatorAssuranceLevel:()=>ok({currentLevel:aal,nextLevel:verified.length?'aal2':'aal1'}),
      unenroll:({factorId})=>{calls.push(['unenroll',factorId]);return ok({id:factorId});},
      enroll:({factorType,friendlyName})=>{calls.push(['enroll',factorType,friendlyName]);return ok({id:'new-factor',totp:{qr_code:'test-qr',secret:'test-secret'}});},
      challenge:({factorId})=>{calls.push(['challenge',factorId]);return ok({id:'challenge'});},
      verify:({factorId,challengeId,code})=>{calls.push(['verify',factorId,challengeId,code]);return ok({});}
    }
  };
  return {controller:createMfaController({auth}),calls};
}
test('cannot remove the last verified authenticator',async()=>{
  const {controller,calls}=client({verified:['primary']});
  await assert.rejects(controller.removeFactor('primary'),/last verified factor/);
  assert.deepEqual(calls,[]);
});
test('cannot remove a factor without AAL2',async()=>{
  const {controller,calls}=client({aal:'aal1'});
  await assert.rejects(controller.removeFactor('primary'),/MFA verification required/);
  assert.deepEqual(calls,[]);
});
test('cannot remove a factor that does not belong to verified factors',async()=>{
  const {controller,calls}=client();
  await assert.rejects(controller.removeFactor('unknown'),/not verified/);
  assert.deepEqual(calls,[]);
});
test('can remove one of two verified factors after AAL2',async()=>{
  const {controller,calls}=client();
  await controller.removeFactor('backup');
  assert.deepEqual(calls,[['unenroll','backup']]);
});
test('backup enrollment requires verified MFA',async()=>{
  const {controller,calls}=client({aal:'aal1'});
  await assert.rejects(controller.enroll('FlowPay backup authenticator'),/Verify your existing authenticator/);
  assert.deepEqual(calls,[]);
});
test('backup enrollment succeeds after AAL2',async()=>{
  const {controller,calls}=client();
  const result=await controller.enroll('FlowPay backup authenticator');
  assert.equal(result.factorId,'new-factor');
  assert.deepEqual(calls,[['enroll','totp','FlowPay backup authenticator']]);
});
test('six-digit code validation happens before MFA challenge',async()=>{
  const {controller,calls}=client();
  await assert.rejects(controller.verify('primary','abc'),/six-digit/);
  assert.deepEqual(calls,[]);
});
