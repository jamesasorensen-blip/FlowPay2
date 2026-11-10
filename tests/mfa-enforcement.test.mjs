import test from 'node:test';
import assert from 'node:assert/strict';
import { requiresMfa } from '../cloudflare/staging-worker.mjs';

const enforced = { REQUIRE_MFA_AAL2: 'true' };
const disabled = { REQUIRE_MFA_AAL2: 'false' };
const aal1 = { aal: 'aal1' };
const aal2 = { aal: 'aal2' };

for (const [path, method] of [
  ['/user-data', 'GET'], ['/bank-accounts', 'GET'],
  ['/bank-transactions', 'GET'], ['/sync-transactions', 'POST'],
  ['/link-token', 'POST'], ['/exchange-token', 'POST'],
  ['/consent', 'GET'], ['/consent/withdraw', 'POST'],
  ['/my-data', 'GET'], ['/bank-connections/00000000-0000-4000-8000-000000000000', 'DELETE'],
  ['/me', 'POST']
]) {
  test(`AAL1 blocked on ${method} ${path} when enforced`, () => {
    assert.equal(requiresMfa(aal1, enforced, path, method), true);
  });
  test(`AAL2 allowed on ${method} ${path} when enforced`, () => {
    assert.equal(requiresMfa(aal2, enforced, path, method), false);
  });
  test(`disabled gate allows AAL1 on ${method} ${path}`, () => {
    assert.equal(requiresMfa(aal1, disabled, path, method), false);
  });
}
test('AAL1 GET /me stays available for enrollment', () => {
  assert.equal(requiresMfa(aal1, enforced, '/me', 'GET'), false);
});
test('missing AAL is not treated as AAL2', () => {
  assert.equal(requiresMfa({}, enforced, '/user-data', 'GET'), true);
});
