import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/staging-worker.mjs';

const enc = new TextEncoder();
const b64 = bytes => Buffer.from(bytes).toString('base64url');
const uuid='0b2cf21b-5147-4337-b73d-fbba9f1a514d';
const session='f3acfe6a-c28e-4ca2-bdd7-3d7fdf2f72e9';
const base='https://test-flowpay.supabase.co';
const originalFetch=globalThis.fetch;

async function setup(aal,{active=true}={}) {
  const keyPair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',keyPair.publicKey);
  const kid='integration-'+aal;
  const header=b64(enc.encode(JSON.stringify({alg:'ES256',kid,typ:'JWT'})));
  const payload=b64(enc.encode(JSON.stringify({
    iss:base+'/auth/v1',aud:'authenticated',role:'authenticated',sub:uuid,
    email:'test@example.invalid',aal,session_id:session,exp:Math.floor(Date.now()/1000)+300
  })));
  const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keyPair.privateKey,enc.encode(header+'.'+payload));
  const token=header+'.'+payload+'.'+b64(signature);
  globalThis.fetch=async (input,options={})=>{
    const url=String(input);
    if(url===base+'/auth/v1/.well-known/jwks.json')
      return Response.json({keys:[{...jwk,kid,alg:'ES256',use:'sig'}]});
    if(url===base+'/functions/v1/flowpay-session-lookup')
      return Response.json({active,session:active?{id:session,user_id:uuid,not_after:null}:null});
    throw new Error('Unexpected outbound request: '+url);
  };
  const env={
    SUPABASE_URL:base,STAGING_TEST_USER_ID:uuid,PLAID_ENV:'sandbox',
    REQUIRE_MFA_AAL2:'true',REQUIRE_ACTIVE_SESSION:'true',
    SESSION_LOOKUP_URL:base+'/functions/v1/flowpay-session-lookup',
    SESSION_LOOKUP_SECRET:'test-only-secret-at-least-32-characters'
  };
  return async path=>{
    const request=new Request('https://worker.example'+path,{headers:{
      Authorization:'Bearer '+token,Origin:'https://flowpay-staging.onrender.com'
    }});
    const response=await worker.fetch(request,env);
    return {status:response.status,body:await response.json()};
  };
}
test('signed AAL1 JWT gets identity but no financial data',async()=>{
  try{
    const probe=await setup('aal1');
    assert.equal((await probe('/me')).status,200);
    const financial=await probe('/user-data');
    assert.equal(financial.status,403);
    assert.equal(financial.body.error,'MFA_REQUIRED');
  }finally{globalThis.fetch=originalFetch;}
});
test('signed AAL2 JWT reaches financial route',async()=>{
  try{
    const probe=await setup('aal2');
    assert.equal((await probe('/me')).status,200);
    const financial=await probe('/user-data');
    assert.notEqual(financial.status,403);
    assert.equal(financial.status,503); // no DB in test env: proves MFA gate passed
    assert.equal(financial.body.error,'Database unavailable');
  }finally{globalThis.fetch=originalFetch;}
});

test('revoked session is rejected even with signed AAL2 JWT',async()=>{
  try{
    const probe=await setup('aal2',{active:false});
    const r=await probe('/user-data');
    assert.equal(r.status,401);
    assert.equal(r.body.error,'SESSION_INVALID');
  }finally{globalThis.fetch=originalFetch;}
});
