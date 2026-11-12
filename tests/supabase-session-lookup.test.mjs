import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyActiveSession } from '../cloudflare/mfa-session-check.mjs';
import { createSupabaseSessionLookup } from '../cloudflare/supabase-session-lookup.mjs';

const user = '0b2cf21b-5147-4337-b73d-fbba9f1a514d';
const session = 'a93af541-b3d4-4d55-97d7-6d9f9ab9a876';
const base = 'https://test-flowpay.supabase.co';
const endpoint = base + '/functions/v1/flowpay-session-lookup';
const secret = 's'.repeat(32);
const config = { SUPABASE_URL: base, SESSION_LOOKUP_URL: endpoint, SESSION_LOOKUP_SECRET: secret };
const claims = { sub: user, session_id: session };

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
