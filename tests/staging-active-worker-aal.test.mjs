import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/candidates/staging-worker-origin-fix.mjs';
const base='https://test-flowpay.supabase.co',id='0b2cf21b-5147-4337-b73d-fbba9f1a514d',enc=new TextEncoder();
const b64=s=>Buffer.from(s).toString('base64url');
let seq=0;
async function probe(aal,{tamper=false}={}){
 const original=globalThis.fetch,key=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),jwk=await crypto.subtle.exportKey('jwk',key.publicKey),kid='aal-probe-'+(++seq);
 const claims={iss:base+'/auth/v1',aud:'authenticated',role:'authenticated',sub:id,exp:Math.floor(Date.now()/1000)+300,...(aal===undefined?{}:{aal})};
 const h=b64(JSON.stringify({alg:'ES256',kid})),p=b64(JSON.stringify(claims));
 const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key.privateKey,enc.encode(h+'.'+p));
 const token=h+'.'+(tamper?b64(JSON.stringify({...claims,aal:'aal2'})):p)+'.'+b64(signature);
 globalThis.fetch=async url=>{assert.equal(String(url),base+'/auth/v1/.well-known/jwks.json');return Response.json({keys:[{...jwk,kid,alg:'ES256',use:'sig'}]});};
 try{const r=await worker.fetch(new Request('https://staging.invalid/me',{headers:{Origin:'https://flowpay-staging.onrender.com',Authorization:'Bearer '+token}}),{SUPABASE_URL:base,PLAID_ENV:'sandbox',STAGING_TEST_USER_ID:id});return {status:r.status,body:await r.json()};}finally{globalThis.fetch=original;}
}
for(const [claim,expected] of [['aal1','aal1'],['aal2','aal2'],[undefined,'aal1'],['unexpected','aal1']])test('session metadata reports signed assurance '+String(claim),async()=>{const r=await probe(claim);assert.equal(r.status,200);assert.equal(r.body.user.aal,expected);});
test('changing an AAL1 payload to AAL2 without a new signature is rejected',async()=>{const r=await probe('aal1',{tamper:true});assert.equal(r.status,401);assert.equal(r.body.success,false);});
