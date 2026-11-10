'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

test('frontend server smoke and security checks', async (t) => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: require('node:path').join(__dirname, '..'),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => child.kill());
  const errors = [];
  child.stderr.on('data', chunk => errors.push(String(chunk)));
  await Promise.race([
    once(child.stdout, 'data'),
    once(child, 'exit').then(() => { throw new Error('Server exited: ' + errors.join('')); }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Server startup timed out')), 10000))
  ]);
  const get = (path) => fetch('http://127.0.0.1:' + port + path, { redirect: 'manual' });
  const home = await get('/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /<html/i);
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
  assert.equal(home.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.match(home.headers.get('strict-transport-security') || '', /max-age=/);
  const retired = await get('/api/plaid');
  assert.equal(retired.status, 410);
  assert.deepEqual(await retired.json(), { error: 'Legacy API retired' });
  for (const path of ['/server.js', '/package.json', '/package-lock.json', '/.env', '/.git/config', '/not-a-real-page']) {
    const response = await get(path);
    assert.equal(response.status, 404, path + ' must not be public');
  }
});
