import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseSessionLookup } from '../cloudflare/supabase-session-lookup.mjs';
import { verifyActiveSession } from '../cloudflare/mfa-session-check.mjs';

const userId = '0b2cf21b-5147-4337-b73d-fbba9f1a514d';
const sessionId = '123e4567-e89b-42d3-a456-426614174000';
const env = {
  SUPABASE_URL: 'https://sdiovjwtphqvfjlyoxeq.supabase.co',
  SESSION_LOOKUP_URL: 'https://sdiovjwtphqvfjlyoxeq.supabase.co/functions/v1/flowpay-session-lookup',
  SESSION_LOOKUP_SECRET: 'a'.repeat(40)
};
test('session lookup prevents redirects and sends only to expected endpoint', async () => {
  let observed;
  const lookup = createSupabaseSessionLookup(env, async (url, options) => {
    observed = { url, options };
    return { ok: true, json: async () => ({ active: true, session: { id: sessionId, user_id: userId, not_after: null } }) };
  });
  assert.equal((await lookup(sessionId)).user_id, userId);
  assert.equal(observed.url, env.SESSION_LOOKUP_URL);
  assert.equal(observed.options.redirect, 'manual');
  assert.equal(observed.options.method, 'POST');
  assert.equal(observed.options.headers.Authorization, 'Bearer ' + env.SESSION_LOOKUP_SECRET);
});
test('lookup refuses untrusted destination before sending credentials', () => {
  assert.throws(() => createSupabaseSessionLookup({
    ...env, SESSION_LOOKUP_URL: 'https://attacker.example/steal'
  }, async () => { throw Error('must not be called'); }));
});
test('active session with matching identity is accepted', async () => {
  assert.equal(await verifyActiveSession(
    { sub: userId, session_id: sessionId },
    async () => ({ id: sessionId, user_id: userId, not_after: null })
  ), true);
});
test('revoked, mismatched, expired and unavailable sessions fail closed', async () => {
  const claims = { sub: userId, session_id: sessionId };
  for (const lookup of [
    async () => null,
    async () => ({ id: sessionId, user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
    async () => ({ id: sessionId, user_id: userId, not_after: '2020-01-01T00:00:00Z' }),
    async () => { throw Error('lookup outage'); }
  ]) assert.equal(await verifyActiveSession(claims, lookup), false);
});
test('invalid session ids never trigger lookup', async () => {
  let called = false;
  const lookup = createSupabaseSessionLookup(env, async () => { called = true; throw Error('unexpected'); });
  assert.equal(await lookup('invalid'), null);
  assert.equal(called, false);
});
