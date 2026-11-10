// Run locally ONLY against the staging Worker after the staging-only MFA gate is enabled.
// Never commit tokens, paste them into chat, or store them in GitHub Actions secrets.
// Example: FLOWPAY_STAGING_AAL1_TOKEN=... FLOWPAY_STAGING_AAL2_TOKEN=... node --test tests/staging-authenticated-mfa.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

const base = 'https://flowpay-plaid-api-staging.james-a-sorensen.workers.dev';
const aal1 = process.env.FLOWPAY_STAGING_AAL1_TOKEN;
const aal2 = process.env.FLOWPAY_STAGING_AAL2_TOKEN;
const enabled = process.env.FLOWPAY_STAGING_MFA_GATE_ENABLED === 'true';

if (!enabled || !aal1 || !aal2) {
  test('authenticated staging MFA probe is opt-in', {skip:'Requires staging-only gate and two local tokens'},()=>{});
} else {
  async function probe(token,path) {
    const response=await fetch(base+path,{
      headers:{Authorization:'Bearer '+token,Origin:'https://flowpay-staging.onrender.com'},
      redirect:'manual',signal:AbortSignal.timeout(10000)
    });
    const payload=await response.json().catch(()=>({}));
    return {status:response.status,error:payload.error};
  }
  test('AAL1 session may access enrollment identity only',async()=>{
    const r=await probe(aal1,'/me');
    assert.equal(r.status,200);
  });
  test('AAL1 session is denied financial data',async()=>{
    const r=await probe(aal1,'/user-data');
    assert.equal(r.status,403);
    assert.equal(r.error,'MFA_REQUIRED');
  });
  test('AAL2 session may access financial data',async()=>{
    const r=await probe(aal2,'/user-data');
    assert.equal(r.status,200);
  });
}
