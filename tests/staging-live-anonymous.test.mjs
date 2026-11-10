import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'https://flowpay-plaid-api-staging.james-a-sorensen.workers.dev';
const routes = [
  ['/me', 'GET'], ['/user-data', 'GET'], ['/bank-accounts', 'GET'],
  ['/bank-transactions', 'GET'], ['/my-data', 'GET'],
  ['/link-token', 'POST'], ['/sync-transactions', 'POST']
];

for (const [route, method] of routes) {
  test(`staging denies anonymous ${method} ${route}`, { timeout: 15000 }, async () => {
    const response = await fetch(BASE + route, {
      method,
      headers: { 'Content-Type': 'application/json', Origin: 'https://flowpay-staging.onrender.com' },
      ...(method === 'POST' ? { body: '{}' } : {}),
      redirect: 'manual',
      signal: AbortSignal.timeout(10000)
    });
    assert.equal(response.status, 401, `${method} ${route}: HTTP ${response.status}`);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://flowpay-staging.onrender.com');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
}

test('staging rejects forged bearer token', { timeout: 15000 }, async () => {
  const response = await fetch(BASE + '/user-data', {
    headers: { Authorization: 'Bearer definitely-not-a-jwt', Origin: 'https://flowpay-staging.onrender.com' },
    redirect: 'manual',
    signal: AbortSignal.timeout(10000)
  });
  assert.equal(response.status, 401);
});
test('staging denies untrusted browser origin preflight', { timeout: 15000 }, async () => {
  const response = await fetch(BASE + '/user-data', {
    method: 'OPTIONS',
    headers: { Origin: 'https://untrusted.example', 'Access-Control-Request-Method': 'GET' },
    redirect: 'manual',
    signal: AbortSignal.timeout(10000)
  });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});
