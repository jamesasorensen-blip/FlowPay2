import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/candidates/staging-worker-origin-fix.mjs';
const base='https://staging.invalid';
for(const origin of ['https://flowpay-staging.onrender.com','https://flowpay-6aay.onrender.com']){
 test('preflight permits only the explicit FlowPay origin: '+origin,async()=>{
  const r=await worker.fetch(new Request(base+'/user-data',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'PUT','Access-Control-Request-Headers':'Authorization,Content-Type'}}),{});
  assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin);assert.equal(r.headers.get('Vary'),'Origin');assert.ok(!r.headers.get('Access-Control-Allow-Origin').includes('*'));
 });
 test('anonymous financial reads still require authentication: '+origin,async()=>{
  const r=await worker.fetch(new Request(base+'/user-data',{headers:{Origin:origin}}),{PLAID_ENV:'sandbox'});
  assert.equal(r.status,401);assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin);
 });
}
for(const origin of ['https://untrusted.example','https://flowpay-staging.onrender.com.attacker.example','null'])test('preflight rejects '+origin,async()=>{
 const r=await worker.fetch(new Request(base+'/user-data',{method:'OPTIONS',headers:{Origin:origin}}),{});assert.equal(r.status,403);assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);
});
test('Sandbox-only restriction is preserved',async()=>{
 const r=await worker.fetch(new Request(base+'/user-data',{headers:{Origin:'https://flowpay-staging.onrender.com'}}),{PLAID_ENV:'production'});assert.equal(r.status,403);assert.equal((await r.json()).error,'Sandbox only');
});
