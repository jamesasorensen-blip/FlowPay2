import test from 'node:test';
import assert from 'node:assert/strict';
// Exercise the exact deploy artifact with the same signed-JWT and route probes.
const { default: worker } = await import(process.env.FLOWPAY_TEST_LIVE_SNAPSHOT === 'true'
 ? '../cloudflare/snapshots/staging-worker-00303e2b.mjs'
 : process.env.FLOWPAY_TEST_BUNDLE === 'true'
 ? '../cloudflare/candidates/staging-mfa-bundled.mjs'
 : '../cloudflare/candidates/main-worker-mfa-integration.mjs');
const base='https://test-flowpay.supabase.co',id='0b2cf21b-5147-4337-b73d-fbba9f1a514d',enc=new TextEncoder();
const b64=s=>Buffer.from(s).toString('base64url');
let seq=0;
async function probe(aal,{tamper=false,path='/me',method='GET',flags={},session='active',subject=id}={}){
 const original=globalThis.fetch,key=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),jwk=await crypto.subtle.exportKey('jwk',key.publicKey),kid='aal-probe-'+(++seq);
 const claims={iss:base+'/auth/v1',aud:'authenticated',role:'authenticated',sub:subject,session_id:'a93af541-b3d4-4d55-97d7-6d9f9ab9a876',exp:Math.floor(Date.now()/1000)+300,...(aal===undefined?{}:{aal})};
 const h=b64(JSON.stringify({alg:'ES256',kid})),p=b64(JSON.stringify(claims));
 const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key.privateKey,enc.encode(h+'.'+p));
 const token=h+'.'+(tamper?b64(JSON.stringify({...claims,aal:'aal2'})):p)+'.'+b64(signature);
 globalThis.fetch=async (url,init)=>{
  if(String(url)===base+'/functions/v1/flowpay-session-lookup'){
    assert.equal(init.headers.Authorization,'Bearer '+'s'.repeat(32));
    if(session==='outage')throw Error('unavailable');
    if(session==='timeout')throw new DOMException('Timed out','TimeoutError');
    if(session==='service-unavailable')return new Response(null,{status:503});
    if(session==='lookup-unauthorized')return new Response(null,{status:401});
    if(session==='rate-limited')return new Response(null,{status:429});
    if(session==='malformed-json')return new Response('not json',{status:200});
    return Response.json({active:session!=='revoked',session:{id:'a93af541-b3d4-4d55-97d7-6d9f9ab9a876',user_id:session==='foreign'?'1b2cf21b-5147-4337-b73d-fbba9f1a514d':id,not_after:session==='expired'?'2020-01-01T00:00:00Z':null}});
  }
  assert.equal(String(url),base+'/auth/v1/.well-known/jwks.json');
  return Response.json({keys:[{...jwk,kid,alg:'ES256',use:'sig'}]});
 };
 try{const r=await worker.fetch(new Request('https://staging.invalid'+path,{method,headers:{Origin:'https://flowpay-staging.onrender.com',Authorization:'Bearer '+token}}),{SUPABASE_URL:base,PLAID_ENV:'sandbox',STAGING_TEST_USER_ID:id,SESSION_LOOKUP_URL:base+'/functions/v1/flowpay-session-lookup',SESSION_LOOKUP_SECRET:'s'.repeat(32),...flags});return {status:r.status,body:await r.json()};}finally{globalThis.fetch=original;}
}
for(const [claim,expected] of [['aal1','aal1'],['aal2','aal2'],[undefined,'aal1'],['unexpected','aal1']])test('session metadata reports signed assurance '+String(claim),async()=>{const r=await probe(claim);assert.equal(r.status,200);assert.equal(r.body.user.aal,expected);});
test('changing an AAL1 payload to AAL2 without a new signature is rejected',async()=>{const r=await probe('aal1',{tamper:true});assert.equal(r.status,401);assert.equal(r.body.success,false);});

for(const flag of ['REQUIRE_MFA_AAL2','REQUIRE_AAL2']){
 test(flag+' permits enrollment metadata but withholds session id',async()=>{
  const r=await probe('aal1',{flags:{[flag]:'true'}});assert.equal(r.status,200);assert.equal(r.body.user.aal,'aal1');assert.equal('session_id' in r.body.user,false);
 });
 for(const [path,method] of [['/user-data','GET'],['/user-data','PUT'],['/consent','GET'],['/bank-accounts','GET'],['/bank-transactions','GET'],['/sync-transactions','POST'],['/link-token','POST'],['/exchange-token','POST'],['/my-data','GET']]){
  test(flag+' blocks AAL1 '+method+' '+path,async()=>{
   const r=await probe('aal1',{path,method,flags:{[flag]:'true'}});assert.equal(r.status,403);assert.equal(r.body.error,'MFA_REQUIRED');
  });
 }
 test(flag+' permits AAL2 to reach the data layer',async()=>{
  const r=await probe('aal2',{path:'/user-data',flags:{[flag]:'true'}});assert.equal(r.status,503);assert.equal(r.body.error,'Database unavailable');
 });
}
for(const session of ['revoked','foreign','expired','outage'])test('active-session gate rejects '+session+' session even at AAL2',async()=>{
 const r=await probe('aal2',{session,flags:{REQUIRE_ACTIVE_SESSION:'true'}});assert.equal(r.status,401);assert.equal(r.body.error,'SESSION_INVALID');
});
test('active session allows enrollment at AAL1',async()=>{
 const r=await probe('aal1',{flags:{REQUIRE_ACTIVE_SESSION:'true',REQUIRE_MFA_AAL2:'true'}});assert.equal(r.status,200);
});
test('invalid lookup configuration fails closed',async()=>{
 const r=await probe('aal2',{flags:{REQUIRE_ACTIVE_SESSION:'true',SESSION_LOOKUP_URL:'https://untrusted.invalid/'}});assert.equal(r.status,401);
});
test('different signed user is denied before data access',async()=>{
 const r=await probe('aal2',{subject:'1b2cf21b-5147-4337-b73d-fbba9f1a514d'});assert.equal(r.status,403);assert.equal(r.body.error,'Staging access restricted');
});

// The candidate changes only authentication and the pre-route security gate.
// Preserve the newer banking, webhook validation, job processing and scheduler.
import fs from 'node:fs';
test('captured active staging Worker retains the reviewed candidate body',()=>{
 const snapshot=fs.readFileSync(new URL('../cloudflare/snapshots/staging-worker-00303e2b.mjs',import.meta.url),'utf8');
 const candidate=fs.readFileSync(new URL('../cloudflare/candidates/main-worker-mfa-integration.mjs',import.meta.url),'utf8');
 const marker='const PLAID_URL =';
 assert.ok(snapshot.includes(marker) && candidate.includes(marker));
 assert.equal(snapshot.slice(snapshot.indexOf(marker)).trimEnd(),candidate.slice(candidate.indexOf(marker)).trimEnd());
});
test('newer webhook, banking and scheduled implementations are retained verbatim',()=>{
 const live=fs.readFileSync(new URL('../cloudflare/staging-worker.mjs',import.meta.url),'utf8');
 const candidate=fs.readFileSync(new URL('../cloudflare/candidates/main-worker-mfa-integration.mjs',import.meta.url),'utf8');
 // Compare the unchanged helper and banking implementation before the intentionally
 // modified CORS allowlist and security gate. Comparing through 'let user'
 // incorrectly includes those deliberately changed sections.
 const middle='function getKeyBytes';
 const cors='    const allowed =';
 assert.ok(live.includes(middle) && candidate.includes(middle));
 assert.ok(live.includes(cors) && candidate.includes(cors));
 assert.equal(candidate.slice(candidate.indexOf(middle),candidate.indexOf(cors)),live.slice(live.indexOf(middle),live.indexOf(cors)));
 const routes='      // CONSENT: READ';
 assert.equal(candidate.slice(candidate.indexOf(routes)),live.slice(live.indexOf(routes)));
});


for (const session of ['revoked', 'foreign', 'expired', 'outage']) {
 test('GET /me fails closed for '+session+' session when active-session gate enabled',async()=>{
  const r=await probe('aal2',{path:'/me',session,flags:{REQUIRE_ACTIVE_SESSION:'true'}});
  assert.equal(r.status,401);
  assert.equal(r.body.error,'SESSION_INVALID');
 });
}

// Fault-injection runs against source, deploy bundle and captured active code.
// A successful signature/AAL2 must never substitute for an available session store.
for (const failure of ['timeout','service-unavailable','lookup-unauthorized','rate-limited','malformed-json']) {
 for (const [path,method] of [['/me','GET'],['/user-data','GET'],['/user-data','PUT'],['/consent','GET'],['/bank-accounts','GET'],['/bank-transactions','GET'],['/sync-transactions','POST'],['/link-token','POST'],['/exchange-token','POST'],['/my-data','GET']]) {
  test(failure+' denies signed AAL2 '+method+' '+path,async()=>{
   const r=await probe('aal2',{path,method,session:failure,flags:{REQUIRE_ACTIVE_SESSION:'true'}});
   assert.equal(r.status,401);
   assert.deepEqual(r.body,{success:false,error:'SESSION_INVALID'});
  });
 }
}
test('GET /me remains accessible to an active AAL1 session for MFA enrollment',async()=>{
 const r=await probe('aal1',{path:'/me',flags:{REQUIRE_ACTIVE_SESSION:'true',REQUIRE_MFA_AAL2:'true'}});
 assert.equal(r.status,200);
 assert.equal(r.body.user.aal,'aal1');
 assert.equal('session_id' in r.body.user,false);
});


for (const [path,method] of [['/user-data','GET'],['/user-data','PUT'],['/consent','GET'],['/bank-accounts','GET'],['/bank-transactions','GET'],['/sync-transactions','POST'],['/link-token','POST'],['/exchange-token','POST'],['/my-data','GET']]) {
 test('revoked session cannot access '+method+' '+path+' even with signed AAL2',async()=>{
  const r=await probe('aal2',{path,method,session:'revoked',flags:{REQUIRE_ACTIVE_SESSION:'true'}});
  assert.equal(r.status,401);
  assert.equal(r.body.error,'SESSION_INVALID');
 });
}
