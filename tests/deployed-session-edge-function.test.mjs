import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = readFileSync(new URL('../supabase/functions/flowpay-session-lookup/index.ts', import.meta.url), 'utf8');
const session = 'a93af541-b3d4-4d55-97d7-6d9f9ab9a876';
const user = '0b2cf21b-5147-4337-b73d-fbba9f1a514d';
const secret = 'a'.repeat(48);

function setup({ rows = [], env = {}, databaseError = false } = {}) {
  let handler;
  let queries = 0;
  // Execute the exact deployed-source snapshot with only the Deno-specific import
  // and TypeScript parameter annotation adapted for Node's isolated VM.
  const executable = source
    .replace(/^import postgres from "npm:postgres@3\.4\.3";\s*/m, '')
    .replace('header: string | null', 'header');
  const sandbox = {
    crypto: webcrypto, TextEncoder, Request, Response, Date, Uint8Array,
    postgres: () => (strings, ...values) => {
      queries++;
      assert.match(strings.join('?'), /flowpay_session_private\.lookup_active_session/);
      assert.deepEqual(values, [session, user]);
      if (databaseError) throw new Error('database down');
      return rows;
    },
    Deno: {
      env: { get: key => ({ SUPABASE_DB_URL: 'postgres://mock', FLOWPAY_SESSION_LOOKUP_SECRET: secret, FLOWPAY_STAGING_TEST_USER_ID: user, ...env })[key] },
      serve: callback => { handler = callback; }
    }
  };
  vm.runInNewContext(executable, sandbox, { timeout: 1000 });
  const request = (body = { session_id: session }, authorization = 'Bearer ' + secret, method = 'POST') =>
    handler(new Request('https://example.test/', { method, headers: { Authorization: authorization }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) }));
  return { request, queries: () => queries };
}

test('unauthorized requests and non-POST methods never query the database', async () => {
  const app = setup();
  assert.equal((await app.request({}, 'Bearer invalid')).status, 401);
  assert.equal((await app.request({}, 'Bearer ' + secret, 'GET')).status, 405);
  assert.equal(app.queries(), 0);
});

test('missing secrets and staging allowlist configuration fail closed', async () => {
  for (const env of [{ FLOWPAY_SESSION_LOOKUP_SECRET: '' }, { FLOWPAY_STAGING_TEST_USER_ID: '' }, { SUPABASE_DB_URL: '' }]) {
    const app = setup({ env });
    const response = await app.request();
    assert.equal(response.status, 503);
    assert.equal(app.queries(), 0);
  }
});

test('invalid session IDs and oversized requests do not reach the database', async () => {
  const app = setup();
  assert.equal((await app.request({ session_id: 'not-a-uuid' })).status, 400);
  assert.equal((await app.request({ session_id: session, padding: 'x'.repeat(300) })).status, 400);
  assert.equal(app.queries(), 0);
});

test('revoked, expired and database-error sessions fail closed', async () => {
  for (const rows of [[], [{ id: session, user_id: user, not_after: '2020-01-01T00:00:00Z' }]]) {
    const response = await setup({ rows }).request();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).active, false);
  }
  assert.equal((await setup({ databaseError: true }).request()).status, 503);
});

test('valid allowlisted session returns minimal non-cacheable metadata', async () => {
  const app = setup({ rows: [{ id: session, user_id: user, not_after: null, email: 'never-return@example.test' }] });
  const response = await app.request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { active: true, session: { id: session, user_id: user, not_after: null } });
  assert.equal(app.queries(), 1);
});
