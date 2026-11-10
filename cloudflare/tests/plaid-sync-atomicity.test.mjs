import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../staging-worker.mjs", import.meta.url), "utf8");
const sync = source.split("// TRANSACTION SYNCHRONIZATION")[1].split("// TRANSACTION HISTORY")[0];

test("sync commits transactions, cursor and audit in a single D1 batch", () => {
  assert.match(sync, /const results = await env\.DB\.batch\(statements\)/);
  assert.match(sync, /statements\.push\(env\.DB\.prepare\([\s\S]*?UPDATE bank_connections SET sync_cursor/);
  assert.match(sync, /statements\.push\(env\.DB\.prepare\([\s\S]*?INSERT INTO security_audit_log/);
  assert.doesNotMatch(sync, /await saveTransaction\(/);
});

test("sync rejects excessive changes and malformed cursors before writes", () => {
  assert.match(sync, /additions\.length \+ modifications\.length \+ removals\.length > 500/);
  assert.match(sync, /typeof page\.next_cursor !== "string"/);
  assert.match(sync, /typeof page\.has_more !== "boolean"/);
  assert.ok(sync.indexOf("Sync change limit exceeded") < sync.indexOf("env.DB.batch(statements)"));
});
