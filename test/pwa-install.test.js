'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

test('PWA manifest identifies an installable standalone application', () => {
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.name && manifest.short_name);
  assert.ok(manifest.start_url.startsWith('/'));
  assert.ok(/^#[0-9a-f]{6}$/i.test(manifest.theme_color));
});

test('PWA icon declarations point to real PNG files', () => {
  for (const size of [192, 512]) {
    const icon = manifest.icons.find(x => x.sizes === size + 'x' + size && x.type === 'image/png');
    assert.ok(icon, 'missing ' + size + 'px icon');
    assert.ok(/^\/[a-z0-9._-]+\.png$/i.test(icon.src), 'unsafe icon path');
    const data = fs.readFileSync(path.join(root, icon.src.slice(1)));
    assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'invalid PNG');
    assert.equal(data.readUInt32BE(16), size, 'incorrect PNG width');
    assert.equal(data.readUInt32BE(20), size, 'incorrect PNG height');
  }
});

test('frontend server allowlists manifest and blocks retired API', () => {
  const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(source, /'manifest\.json'/);
  assert.match(source, /app\.use\('\/api'/);
  assert.match(source, /status\(410\)/);
});

test('Docker image includes required PWA installation assets', () => {
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const copies = [...dockerfile.matchAll(/^COPY\\s+([^\\n]+)$/gm)].map(match => match[1]);
  for (const asset of ['index.html', 'server.js', 'manifest.json', 'icon-192.png', 'icon-512.png']) {
    assert.ok(copies.some(line => line.split(/\\s+/).slice(0, -1).includes(asset)), 'Dockerfile does not copy ' + asset);
  }
});
