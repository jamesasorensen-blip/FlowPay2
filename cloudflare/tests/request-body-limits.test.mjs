import test from "node:test";
import assert from "node:assert/strict";
import { readJson } from "../staging-worker.mjs";

test("JSON request parser accepts valid small bodies", async () => {
  const request = new Request("https://example.test", { method: "POST", body: '{"ok":true}' });
  assert.deepEqual(await readJson(request, 32), { ok: true });
});

test("JSON request parser rejects invalid JSON", async () => {
  const request = new Request("https://example.test", { method: "POST", body: "{" });
  await assert.rejects(readJson(request, 32), error => error.status === 400);
});

test("JSON request parser rejects oversized streams before reading the next chunk", async () => {
  let reads = 0;
  const stream = new ReadableStream({
    pull(controller) {
      reads++;
      if (reads === 1) controller.enqueue(new TextEncoder().encode("123456789"));
      else if (reads === 2) controller.enqueue(new TextEncoder().encode("EXTRA"));
      else controller.close();
    }
  }, { highWaterMark: 0 });
  const request = new Request("https://example.test", { method: "POST", body: stream, duplex: "half" });
  await assert.rejects(readJson(request, 8), error => error.status === 413);
  assert.equal(reads, 1);
});

test("JSON request parser enforces UTF-8 byte limit", async () => {
  const request = new Request("https://example.test", { method: "POST", body: '"ééé"' });
  await assert.rejects(readJson(request, 5), error => error.status === 413);
});
