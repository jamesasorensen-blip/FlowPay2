// Server-only test. Provision a DISPOSABLE staging access token through a secret
// manager, never command arguments, source control, browser automation, or logs.
// Run only while staging REQUIRE_ACTIVE_SESSION=true; restore its prior value
// through the approved operator workflow after the test, including on failure.
import { pathToFileURL } from 'node:url';

const worker = 'https://flowpay-plaid-api-staging.james-a-sorensen.workers.dev';
const project = 'https://sdiovjwtphqvfjlyoxeq.supabase.co';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function checkRevocation(env, fetcher = fetch, now = Date.now) {
  const fail = () => ({ success: false, result: 'FAIL: staging revocation check incomplete' });
  if (env.FLOWPAY_STAGING_REVOCATION_TEST !== 'I_CONFIRM_DISPOSABLE_STAGING_SESSION') {
    return { success: false, result: 'SKIP: explicit disposable staging-session confirmation required' };
  }
  const token = env.FLOWPAY_DISPOSABLE_STAGING_ACCESS_TOKEN;
  const key = env.SUPABASE_PUBLISHABLE_KEY;
  const userId = env.FLOWPAY_STAGING_TEST_USER_ID;
  if (!token || !key || !uuid.test(userId || '')) return fail();
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return fail();
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    // These claims are NOT authorization: the live Worker must verify this same
    // token before any sign-out request. Require time to distinguish revocation
    // rejection from ordinary expiry during the test.
    if (claims.sub !== userId || !uuid.test(claims.session_id || '') ||
        claims.iss !== project + '/auth/v1' || !Number.isFinite(claims.exp) ||
        claims.exp * 1000 <= now() + 120000) return fail();
    const request = (url, init = {}) => fetcher(url, {
      ...init, redirect: 'manual', signal: AbortSignal.timeout(10000)
    });
    const headers = { Authorization: 'Bearer ' + token };
    const before = await request(worker + '/me', { headers });
    if (before.status !== 200) return fail();
    const identity = await before.json();
    if (identity.success !== true || identity.user?.id !== userId) return fail();
    // Never use the default global scope: this revokes ONLY the supplied session.
    const logout = await request(project + '/auth/v1/logout?scope=local', {
      method: 'POST', headers: { ...headers, apikey: key }
    });
    if (!logout.ok) return fail();
    const after = await request(worker + '/me', { headers });
    const rejection = await after.json();
    if (after.status !== 401 || rejection.error !== 'SESSION_INVALID' ||
        claims.exp * 1000 <= now()) return fail();
    return { success: true, result: 'PASS: staging rejected the revoked, unexpired disposable session' };
  } catch {
    // Network exceptions and response bodies may contain credentials or IDs.
    return fail();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await checkRevocation(process.env);
  console.log(result.result);
  process.exitCode = result.success ? 0 : result.result.startsWith('SKIP:') ? 2 : 1;
}
