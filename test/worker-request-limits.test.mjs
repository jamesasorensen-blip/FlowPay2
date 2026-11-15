import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { readJson, readRequestText } from '../cloudflare/staging-worker.mjs';

function streamed(chunks, onCancel = () => {}) {
  let index = 0;
  return new Request('https://worker.test/', {
    method: 'POST', duplex: 'half',
    body: new ReadableStream({
      pull(controller) {
        if (index === chunks.length) controller.close();
        else controller.enqueue(chunks[index++]);
      },
      cancel: onCancel
    }, { highWaterMark: 0 })
  });
}
const encode = text => new TextEncoder().encode(text);

test('JSON accepts the exact byte limit and rejects malformed input', async () => {
  assert.deepEqual(await readJson(streamed([encode('{"ok":true}')]), 11), { ok: true });
  await assert.rejects(readJson(streamed([encode('{')])), { status: 400, message: 'Invalid JSON' });
});

test('stream byte limit cancels before consuming the remaining body', async () => {
  let cancelled = false;
  const request = streamed([encode('abc'), encode('def'), encode('unread')], () => { cancelled = true; });
  await assert.rejects(readRequestText(request, 5), { status: 413 });
  assert.equal(cancelled, true);
  assert.equal(request.body.locked, false);
});

test('split multibyte UTF-8 is preserved and counted as bytes', async () => {
  const bytes = encode('"💵"');
  assert.equal(await readJson(streamed([bytes.slice(0, 3), bytes.slice(3)]), 6), '💵');
  await assert.rejects(readJson(streamed([bytes]), 5), { status: 413 });
});

test('bodyless requests and failing streams release their readers', async () => {
  assert.equal(await readRequestText(new Request('https://worker.test/'), 1), '');
  const request = new Request('https://worker.test/', {
    method: 'POST', duplex: 'half',
    body: new ReadableStream({ start(controller) { controller.error(new Error('interrupted')); } })
  });
  await assert.rejects(readRequestText(request, 10), /interrupted/);
  assert.equal(request.body.locked, false);
});

test('oversized webhook returns 413 before Plaid or database access', async () => {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'test-key' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ iat: Math.floor(Date.now()/1000), request_body_sha256: '0'.repeat(64) })).toString('base64url');
  const request = new Request('https://worker.test/plaid-webhook', {
    method: 'POST', headers: { 'Plaid-Verification': `${header}.${claims}.signature` },
    body: 'é'.repeat(32769)
  });
  const response = await worker.fetch(request, { PLAID_ENV: 'sandbox' });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: 'Payload too large' });
});


test('invalid UTF-8 cannot silently change financial JSON strings', async () => {
  for (const chunks of [
    [Uint8Array.from([34, 0xff, 34])],
    [Uint8Array.from([34, 0xe2]), Uint8Array.from([34])],
    [Uint8Array.from([34, 0xe2, 0x82])]
  ]) {
    const request = streamed(chunks);
    await assert.rejects(readJson(request), { status: 400, message: 'Invalid UTF-8' });
    assert.equal(request.body.locked, false);
  }
});

test('raw text preserves a UTF-8 BOM for webhook byte-hash verification', async () => {
  const bytes = encode('\uFEFF{"ok":true}');
  assert.deepEqual(encode(await readRequestText(streamed([bytes.slice(0, 1), bytes.slice(1)]), 20)), bytes);
  await assert.rejects(readJson(streamed([bytes])), { status: 400, message: 'Invalid JSON' });
});

test('malformed UTF-8 webhook is rejected before external or database work', async () => {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'test-key' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ iat: Math.floor(Date.now()/1000), request_body_sha256: '0'.repeat(64) })).toString('base64url');
  const response = await worker.fetch(new Request('https://worker.test/plaid-webhook', {
    method: 'POST', headers: { 'Plaid-Verification': `${header}.${claims}.signature` },
    body: Uint8Array.from([34, 0xff, 34])
  }), { PLAID_ENV: 'sandbox' });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Invalid webhook' });
});
