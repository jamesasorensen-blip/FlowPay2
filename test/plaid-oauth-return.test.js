import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const section = html.slice(html.indexOf('<!-- FlowPay Plaid Sandbox Bank Connection -->'),
  html.indexOf('<!-- End FlowPay Plaid Sandbox -->'));

test('OAuth return resumes Plaid Link with original tab-scoped token', () => {
  assert.match(section, /receivedRedirectUri:redirectUrl/);
  assert.match(section, /new URLSearchParams\(location\.search\)\.has\('oauth_state_id'\)/);
  assert.match(section, /createLink\(data\.token,generation,location\.href\)/);
  assert.match(section, /sessionStorage\.setItem\(oauthKey\(currentUser\)/);
  assert.doesNotMatch(section, /localStorage\.setItem\(oauthKey/);
});

test('OAuth resume is scoped to authenticated user and expires', () => {
  assert.match(section, /const oauthKey = userId => 'flowpay-plaid-oauth:'\+userId/);
  assert.match(section, /Date\.now\(\)-data\.started>25\*60\*1000/);
  assert.match(section, /sessionStorage\.removeItem\(oauthKey\(currentUser\)\)/);
  assert.match(section, /if\(!currentUser \|\| !new URLSearchParams/);
});
