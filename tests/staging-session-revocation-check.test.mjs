import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRevocation } from '../scripts/staging-session-revocation-check.mjs';

const user = '0b2cf21b-5147-4337-b73d-fbba9f1a514d';
const session = 'a93af541-b3d4-4d55-97d7-6d9f9ab9a876';
const now = 1800000000000;
const claims = {sub:user,session_id:session,iss:'https://sdiovjwtphqvfjlyoxeq.supabase.co/auth/v1',exp:now/1000+600};
const token = body => 'header.'+Buffer.from(JSON.stringify(body)).toString('base64url')+'.signature';
const env = {FLOWPAY_STAGING_REVOCATION_TEST:'I_CONFIRM_DISPOSABLE_STAGING_SESSION',FLOWPAY_DISPOSABLE_STAGING_ACCESS_TOKEN:token(claims),SUPABASE_PUBLISHABLE_KEY:'test-only-publishable-key',FLOWPAY_STAGING_TEST_USER_ID:user};
const good = () => [Response.json({success:true,user:{id:user}}),new Response(null,{status:204}),Response.json({error:'SESSION_INVALID'},{status:401})];
function mock(responses) {
 const calls=[];
 return {calls,fetcher:async(url,init)=>{calls.push({url,init});const result=responses.shift();if(result instanceof Error)throw result;assert.ok(result);return result;}};
}
test('requires explicit disposable-session confirmation before any network request',async()=>{
 const m=mock([]);const r=await checkRevocation({...env,FLOWPAY_STAGING_REVOCATION_TEST:''},m.fetcher,()=>now);
 assert.match(r.result,/^SKIP:/);assert.equal(m.calls.length,0);
});
test('missing configuration, wrong identity/issuer and near-expiry tokens never revoke',async()=>{
 for(const patch of [{SUPABASE_PUBLISHABLE_KEY:''},{FLOWPAY_STAGING_TEST_USER_ID:'bad'},...[
  {...claims,sub:session},{...claims,iss:'https://other.supabase.co/auth/v1'},
  {...claims,exp:now/1000+30},{...claims,session_id:'bad'}
 ].map(c=>({FLOWPAY_DISPOSABLE_STAGING_ACCESS_TOKEN:token(c)}))]){
  const m=mock([]);assert.equal((await checkRevocation({...env,...patch},m.fetcher,()=>now)).success,false);assert.equal(m.calls.length,0);
 }
});
test('verifies identity, revokes only local session and requires exact unexpired rejection',async()=>{
 const m=mock(good());const r=await checkRevocation(env,m.fetcher,()=>now);
 assert.equal(r.success,true);assert.equal(m.calls.length,3);
 assert.equal(m.calls[1].url,'https://sdiovjwtphqvfjlyoxeq.supabase.co/auth/v1/logout?scope=local');
 assert.equal(m.calls[1].init.method,'POST');
 assert.equal(m.calls[1].init.headers.apikey,env.SUPABASE_PUBLISHABLE_KEY);
 for(const call of m.calls){assert.equal(call.init.redirect,'manual');assert.ok(call.init.signal);assert.equal(call.init.headers.Authorization,'Bearer '+env.FLOWPAY_DISPOSABLE_STAGING_ACCESS_TOKEN);}
 assert.equal(m.calls[0].init.headers.apikey,undefined);
 assert.doesNotMatch(r.result,new RegExp(user+'|'+session+'|signature|publishable'));
});
test('failed or foreign identity verification stops before logout',async()=>{
 for(const response of [Response.json({error:'Unauthorized'},{status:401}),Response.json({success:true,user:{id:session}})]){
  const m=mock([response]);assert.equal((await checkRevocation(env,m.fetcher,()=>now)).success,false);assert.equal(m.calls.length,1);
 }
});
test('failed logout stops without claiming revocation',async()=>{
 const m=mock([good()[0],new Response(null,{status:403})]);
 assert.equal((await checkRevocation(env,m.fetcher,()=>now)).success,false);assert.equal(m.calls.length,2);
});
test('still accepted token, generic auth failure and redirects cannot pass',async()=>{
 for(const after of [Response.json({success:true}),Response.json({error:'Unauthorized'},{status:401}),new Response(null,{status:302})]){
  const m=mock([...good().slice(0,2),after]);assert.equal((await checkRevocation(env,m.fetcher,()=>now)).success,false);
 }
});
test('ordinary token expiry cannot masquerade as successful revocation',async()=>{
 const m=mock(good());let reads=0;
 assert.equal((await checkRevocation(env,m.fetcher,()=>reads++?claims.exp*1000+1:now)).success,false);
});
test('exceptions are sanitized after any stage',async()=>{
 for(let stage=0;stage<3;stage++){
  const responses=good();responses[stage]=new Error('secret '+env.FLOWPAY_DISPOSABLE_STAGING_ACCESS_TOKEN);
  const m=mock(responses);const r=await checkRevocation(env,m.fetcher,()=>now);
  assert.equal(r.success,false);assert.equal(r.result,'FAIL: staging revocation check incomplete');
 }
});
