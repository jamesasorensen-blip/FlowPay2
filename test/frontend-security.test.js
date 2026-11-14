'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('frontend security headers and retired API', { timeout: 15000 }, async () => {
  const port = await availablePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: require('node:path').join(__dirname, '..'),
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore'
  });
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (child.exitCode !== null) throw new Error('Frontend server exited before readiness');
      try {
        const response = await fetch('http://127.0.0.1:' + port + '/api');
        ready = response.status === 410;
        if (ready) break;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'server became ready');
    for (const route of ['/', '/manual.html', '/sw.js', '/manual-account.mjs']) {
      const response = await fetch('http://127.0.0.1:' + port + route);
      assert.equal(response.headers.get('cache-control'), 'no-store', route);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff', route);
      assert.equal(response.headers.get('x-frame-options'), 'DENY', route);
    }
    const legacy = await fetch('http://127.0.0.1:' + port + '/api/plaid');
    assert.equal(legacy.status, 410);
    const privateFile = await fetch('http://127.0.0.1:' + port + '/package.json');
    assert.equal(privateFile.status, 404);
  } finally {
    child.kill();
  }
});
