import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../staging-worker.mjs", import.meta.url), "utf8");

test("Plaid credentials are sent only to fixed sandbox origin", () => {
  assert.match(source, /const PLAID_URL = "https:\/\/sandbox\.plaid\.com"/);
  assert.match(source, /fetch\(\x60\$\{PLAID_URL\}\$\{endpoint\}\x60/);
});
test("Plaid upstream requests cannot follow credential-bearing redirects", () => {
  assert.match(source, /redirect: "manual"/);
  assert.match(source, /Plaid redirect refused/);
});
test("Plaid upstream requests have a finite timeout", () => {
  assert.match(source, /signal: AbortSignal\.timeout\(15000\)/);
});
