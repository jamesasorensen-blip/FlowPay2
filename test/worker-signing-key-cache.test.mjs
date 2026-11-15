import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/staging-worker.mjs';

const user = '11111111-1111-4111-8111-111111111111';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
async function signingKey(kid) {
  const pair = await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  return {pair, jwk:{...await crypto.subtle.exportKey('jwk',pair.publicKey),kid,alg:'ES256',use:'sig'}};
}
async function token(key, base) {
  const message = encode({alg:'ES256',kid:key.jwk.kid})+'.'+encode({
    sub:user,iss:base+'/auth/v1',aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+600
  });
  return message+'.'+Buffer.from(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key.pair.privateKey,new TextEncoder().encode(message))).toString('base64url');
}
async function call(key, base) {
  return worker.fetch(new Request('https://worker.test/me',{headers:{Authorization:'Bearer '+await token(key,base)}}),{
    SUPABASE_URL:base,PLAID_ENV:'sandbox',STAGING_TEST_USER_ID:user
  });
}

test('cached signing keys cannot authenticate a different configured issuer', async () => {
  const a = await signingKey('same-id');
  const b = await signingKey('same-id');
  const baseA = 'https://cache-a.supabase.co';
  const baseB = 'https://cache-b.supabase.co';
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    requests.push(String(url));
    if (String(url) === baseA+'/auth/v1/.well-known/jwks.json') return Response.json({keys:[a.jwk]});
    if (String(url) === baseB+'/auth/v1/.well-known/jwks.json') return Response.json({keys:[b.jwk]});
    throw Error('Unexpected outbound request');
  };
  try {
    assert.equal((await call(a,baseA)).status,200);
    assert.equal((await call(a,baseB)).status,401,'project A key must not validate project B claims');
    assert.ok(requests.includes(baseB+'/auth/v1/.well-known/jwks.json'));
    assert.equal((await call(b,baseB)).status,200);
    assert.equal((await call(a,baseA)).status,200);
  } finally { globalThis.fetch = originalFetch; }
});

test('same issuer uses cached keys and refreshes for a rotated key ID', async () => {
  const first = await signingKey('rotation-first');
  const second = await signingKey('rotation-second');
  const base = 'https://cache-rotation.supabase.co';
  let requests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(String(url),base+'/auth/v1/.well-known/jwks.json');
    requests++;
    return Response.json({keys:requests === 1 ? [first.jwk] : [first.jwk,second.jwk]});
  };
  try {
    assert.equal((await call(first,base)).status,200);
    assert.equal((await call(first,base)).status,200);
    assert.equal(requests,1);
    assert.equal((await call(second,base)).status,200);
    assert.equal(requests,2);
  } finally { globalThis.fetch = originalFetch; }
});
