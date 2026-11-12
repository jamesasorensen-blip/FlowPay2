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
  const guest = await get('/guest-demo.html');
  assert.equal(guest.status, 200);
  const guestHtml = await guest.text();
  assert.match(guestHtml, /Guest workspace/);
  assert.match(guestHtml, /connect-src 'none'/);
  assert.ok(!guestHtml.includes('supabase.co'));
  assert.ok(!guestHtml.includes('workers.dev'));
  const manual = await get('/manual.html');
  assert.equal(manual.status,200);
  const manualHtml=await manual.text();
  assert.match(manualHtml,/FlowPay manual account/);
  assert.ok(!manualHtml.includes('workers.dev'));
  for(const asset of ['manual-account.mjs','manual-budget-store.mjs','manual-ledger.mjs','manual-mfa.mjs','manual-mfa-ui.mjs']) assert.equal((await get('/'+asset)).status,200);
  const manifest = await get('/manifest.json');
  assert.equal(manifest.status, 200);
  const appManifest = await manifest.json();
  assert.equal(appManifest.display, 'standalone');
  assert.equal(appManifest.start_url, '/');
  assert.ok(appManifest.icons.some(icon => icon.sizes === '192x192'));
  assert.ok(appManifest.icons.some(icon => icon.sizes === '512x512'));
  const manifestAlias = await get('/manifest.webmanifest');
  assert.equal(manifestAlias.status, 200);
  assert.match(manifestAlias.headers.get('content-type') || '', /^application\/manifest\+json/);
  assert.deepEqual(await manifestAlias.json(), appManifest);
  const favicon = await get('/favicon.ico');
  assert.equal(favicon.status, 200);
  assert.match(favicon.headers.get('content-type') || '', /^image\/png/);
  const faviconBytes = Buffer.from(await favicon.arrayBuffer());
  assert.equal(faviconBytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  for (const icon of appManifest.icons) {
    const asset = await get(icon.src);
    assert.equal(asset.status, 200, 'Manifest icon missing: ' + icon.src);
    assert.match(asset.headers.get('content-type') || '', /^image\//);
  }
  const retired = await get('/api/plaid');
  assert.equal(retired.status, 410);
  assert.deepEqual(await retired.json(), { error: 'Legacy API retired' });
  for (const route of ['/api', '/api/', '/api/sync-transactions', '/api/create-link-token']) {
    const response = await get(route);
    assert.equal(response.status, 410, route + ' must remain retired');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
  const head = await fetch('http://127.0.0.1:' + port + '/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('x-frame-options'), 'DENY');
  for (const path of ['/server.js', '/package.json', '/package-lock.json', '/.env', '/.git/config', '/not-a-real-page']) {
    const response = await get(path);
    assert.equal(response.status, 404, path + ' must not be public');
  }
  for (const path of ['/sw.js', '/service-worker.js']) {
    assert.equal((await get(path)).status, 404);
  }
  assert.equal(errors.length, 0, 'Missing optional assets must not emit server errors');
});
