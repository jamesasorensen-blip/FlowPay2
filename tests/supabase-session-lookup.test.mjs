import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyActiveSession } from '../cloudflare/mfa-session-check.mjs';
import { createSupabaseSessionLookup } from '../cloudflare/supabase-session-lookup.mjs';
import { createServer } from 'node:http';

const user = '0b2cf21b-5147-4337-b73d-fbba9f1a514d';
const session = 'a93af541-b3d4-4d55-97d7-6d9f9ab9a876';
const base = 'https://test-flowpay.supabase.co';
const endpoint = base + '/functions/v1/flowpay-session-lookup';
const secret = 's'.repeat(32);
const config = { SUPABASE_URL: base, SESSION_LOOKUP_URL: endpoint, SESSION_LOOKUP_SECRET: secret };
const claims = { sub: user, session_id: session };

test('real fetch aborts a stalled lookup at the adapter deadline and denies access', {timeout:15000}, async()=>{
  let requests=0,signal;
  // Only a loopback fixture receives the dummy test credential. No cloud traffic.
  const server=createServer(request=>{requests++;request.resume();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const lookup=createSupabaseSessionLookup(config,(_url,init)=>{
      signal=init.signal;
      return fetch('http://127.0.0.1:'+server.address().port,{...init});
    });
    assert.equal(await verifyActiveSession(claims,lookup),false);
    assert.equal(requests,1);
    assert.equal(signal.aborted,true);
    assert.equal(signal.reason.name,'TimeoutError');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
});

test('authoritative session ownership and expiry are checked', async () => {
  const active = { id: session, user_id: user, not_after: '2099-01-01T00:00:00Z' };
  assert.equal(await verifyActiveSession(claims, async () => active), true);
  assert.equal(await verifyActiveSession(claims, async () => ({ ...active, user_id: '1b2cf21b-5147-4337-b73d-fbba9f1a514d' })), false);
  assert.equal(await verifyActiveSession(claims, async () => ({ ...active, not_after: '2020-01-01T00:00:00Z' })), false);
  assert.equal(await verifyActiveSession(claims, async () => ({ ...active, not_after: 'invalid' })), false);
  assert.equal(await verifyActiveSession(claims, async () => null), false);
  assert.equal(await verifyActiveSession(claims, async () => { throw Error('outage'); }), false);
  assert.equal(await verifyActiveSession({ ...claims, session_id: 'invalid' }, async () => active), false);
});

test('lookup authenticates server request and returns only session metadata', async () => {
  let count = 0;
  const lookup = createSupabaseSessionLookup(config, async (url, init) => {
    count++;
    assert.equal(url, endpoint);
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, 'Bearer ' + secret);
    assert.equal(init.redirect, 'manual');
    assert.deepEqual(JSON.parse(init.body), { session_id: session });
    return Response.json({ active: true, session: { id: session, user_id: user, not_after: null, email: 'should-not-leak@example.test' } });
  });
  assert.deepEqual(await lookup(session), { id: session, user_id: user, not_after: null });
  assert.equal(count, 1);
  assert.equal(await lookup('not-a-uuid'), null);
  assert.equal(count, 1);
});

test('lookup rejects untrusted endpoints before transmitting a secret', () => {
  for (const url of [
    'http://test-flowpay.supabase.co/functions/v1/flowpay-session-lookup',
    'https://attacker.invalid/functions/v1/flowpay-session-lookup',
    'https://test-flowpay.supabase.co.evil.invalid/functions/v1/flowpay-session-lookup',
    endpoint + '?redirect=1',
    'https://test-flowpay.supabase.co/functions/v1/other'
  ]) assert.throws(() => createSupabaseSessionLookup({ ...config, SESSION_LOOKUP_URL: url }));
  assert.throws(() => createSupabaseSessionLookup({ ...config, SESSION_LOOKUP_SECRET: 'short' }));
});

test('lookup rejects revoked, malformed, and failed authoritative responses', async () => {
  const response = body => createSupabaseSessionLookup(config, async () => Response.json(body));
  assert.equal(await response({ active: false, session: { id: session, user_id: user } })(session), null);
  await assert.rejects(response({ active: true, session: { id: session, user_id: 'bad' } })(session));
  await assert.rejects(createSupabaseSessionLookup(config, async () => new Response('unavailable', { status: 503 }))(session));
});


test('lookup does not accept an active response with missing or mismatched session identity', async () => {
  const lookup = body => createSupabaseSessionLookup(config, async () => Response.json(body));
  assert.equal(await lookup({ active: true })(session), null);
  await assert.rejects(lookup({ active: true, session: { id: '1b2cf21b-5147-4337-b73d-fbba9f1a514d', user_id: user } })(session));
  await assert.rejects(lookup({ active: true, session: { id: session, user_id: 'not-a-uuid' } })(session));
});

test('lookup fails closed on malformed JSON and network errors', async () => {
  const malformed = createSupabaseSessionLookup(config, async () => new Response('not json', { status: 200 }));
  await assert.rejects(malformed(session));
  const unavailable = createSupabaseSessionLookup(config, async () => { throw Error('network unavailable'); });
  await assert.rejects(unavailable(session));
});


test('lookup refuses redirects and authorization failures without trusting response bodies', async () => {
  for (const status of [301, 302, 307, 308, 401, 403, 429, 500, 503]) {
    const lookup = createSupabaseSessionLookup(config, async (_url, init) => {
      assert.equal(init.redirect, 'manual');
      return new Response(null, { status, headers: { Location: 'https://attacker.invalid/collect' } });
    });
    await assert.rejects(lookup(session));
  }
});

test('lookup rejects a response with no usable session object', async () => {
  for (const payload of [null, [], {}, { active: true, session: null }, { active: true, session: [] }, { active: true, session: 'invalid' }]) {
    const lookup = createSupabaseSessionLookup(config, async () => Response.json(payload));
    const result = await lookup(session).catch(() => null);
    assert.equal(result, null);
  }
});
