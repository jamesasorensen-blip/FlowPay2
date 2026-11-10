import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/staging-worker.mjs';

const enc = new TextEncoder();
const b64 = bytes => Buffer.from(bytes).toString('base64url');
const uuid='0b2cf21b-5147-4337-b73d-fbba9f1a514d';
const session='f3acfe6a-c28e-4ca2-bdd7-3d7fdf2f72e9';
const base='https://test-flowpay.supabase.co';
const originalFetch=globalThis.fetch;

let keySequence = 0;
async function setup(aal,{active=true,db}={}) {
  const keyPair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',keyPair.publicKey);
  const kid='integration-'+aal+'-'+(++keySequence);
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
    SESSION_LOOKUP_SECRET:'test-only-secret-at-least-32-characters',DB:db
  };
  return async (path,{method='GET',body}={})=>{
    const request=new Request('https://worker.example'+path,{method,headers:{
      Authorization:'Bearer '+token,Origin:'https://flowpay-staging.onrender.com',
      'Content-Type':'application/json'
    },...(body!==undefined?{body:JSON.stringify(body)}:{})});
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

// Verify the write endpoint refuses invalid revisions before any database writes.
test('cloud writes reject missing, negative, fractional and unsafe revisions',async()=>{
  let dbCalls=0;
  const db={prepare(){dbCalls++;throw new Error('Database must not be touched for invalid input');}};
  try{
    const probe=await setup('aal2',{db});
    for(const body of [
      {data:{bills:[]}},
      {revision:-1,data:{}},
      {revision:0.5,data:{}},
      {revision:Number.MAX_SAFE_INTEGER+1,data:{}},
      {revision:0,data:[]},
      {revision:0,data:null}
    ]){
      const response=await probe('/user-data',{method:'PUT',body});
      assert.equal(response.status,400,JSON.stringify(body));
      assert.equal(response.body.error,'Expected revision and data object');
    }
    assert.equal(dbCalls,0);
  }finally{globalThis.fetch=originalFetch;}
});

// Ensure all cloud write attempts are denied before the DB when MFA is incomplete.
test('AAL1 cannot write financial data, even with a valid revision',async()=>{
  let dbCalls=0;
  const db={prepare(){dbCalls++;throw new Error('Financial DB must remain inaccessible');}};
  try{
    const probe=await setup('aal1',{db});
    const response=await probe('/user-data',{method:'PUT',body:{revision:0,data:{bills:[]}}});
    assert.equal(response.status,403);
    assert.equal(response.body.error,'MFA_REQUIRED');
    assert.equal(dbCalls,0);
  }finally{globalThis.fetch=originalFetch;}
});

test('revoked AAL2 session cannot write financial data',async()=>{
  let dbCalls=0;
  const db={prepare(){dbCalls++;throw new Error('Financial DB must remain inaccessible');}};
  try{
    const probe=await setup('aal2',{active:false,db});
    const response=await probe('/user-data',{method:'PUT',body:{revision:0,data:{bills:[]}}});
    assert.equal(response.status,401);
    assert.equal(response.body.error,'SESSION_INVALID');
    assert.equal(dbCalls,0);
  }finally{globalThis.fetch=originalFetch;}
});

function mockCloudDb(){
 const rows=new Map();
 const db={prepare(sql){
   let args=[];
   return {
     bind(...values){args=values;return this;},
     async first(){
       if(sql.includes('SELECT revision FROM user_data')){const row=rows.get(args[0]);return row?{revision:row.revision}:null;}
       if(sql.includes('SELECT data_json, revision, updated_at')){const row=rows.get(args[0]);return row?{...row}:null;}
       throw new Error('Unexpected SELECT: '+sql);
     },
     async run(){
       if(sql.includes('INSERT OR IGNORE INTO users'))return {meta:{changes:1}};
       if(sql.includes('INSERT OR IGNORE INTO user_data')){
         if(rows.has(args[0]))return {meta:{changes:0}};
         rows.set(args[0],{data_json:args[1],revision:1,updated_at:'2026-11-10'});
         return {meta:{changes:1}};
       }
       if(sql.includes('UPDATE user_data SET')){
         const row=rows.get(args[1]);
         if(!row||row.revision!==args[2])return {meta:{changes:0}};
         rows.set(args[1],{data_json:args[0],revision:row.revision+1,updated_at:'2026-11-10'});
         return {meta:{changes:1}};
       }
       throw new Error('Unexpected write: '+sql);
     }
   };
 }};
 return {db,rows};
}

test('cloud write revisions prevent stale browser overwrites and preserve records',async()=>{
 const {db,rows}=mockCloudDb();
 try{
   const probe=await setup('aal2',{db});
   const first=await probe('/user-data',{method:'PUT',body:{revision:0,data:{bills:[{id:'bill-A'}]}}});
   assert.equal(first.status,200);
   assert.equal(first.body.revision,1);
   const second=await probe('/user-data',{method:'PUT',body:{revision:1,data:{bills:[{id:'bill-B'}]}}});
   assert.equal(second.status,200);
   assert.equal(second.body.revision,2);
   const stale=await probe('/user-data',{method:'PUT',body:{revision:1,data:{bills:[]}}});
   assert.equal(stale.status,409);
   assert.equal(stale.body.current_revision,2);
   const read=await probe('/user-data');
   assert.equal(read.status,200);
   assert.equal(read.body.revision,2);
   assert.deepEqual(read.body.data.bills,[{id:'bill-B'}]);
   assert.equal(rows.size,1);
 }finally{globalThis.fetch=originalFetch;}
});

test('two initial cloud writes cannot overwrite the first revision-zero record',async()=>{
 const {db}=mockCloudDb();
 try{
   const probe=await setup('aal2',{db});
   const first=await probe('/user-data',{method:'PUT',body:{revision:0,data:{bills:[{id:'original'}]}}});
   assert.equal(first.status,200);
   const repeat=await probe('/user-data',{method:'PUT',body:{revision:0,data:{bills:[{id:'replacement'}]}}});
   assert.equal(repeat.status,409);
   const read=await probe('/user-data');
   assert.deepEqual(read.body.data.bills,[{id:'original'}]);
 }finally{globalThis.fetch=originalFetch;}
});
