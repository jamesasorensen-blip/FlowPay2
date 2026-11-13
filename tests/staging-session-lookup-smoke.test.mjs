import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/staging-session-lookup-smoke.mjs", import.meta.url));
const base = {
  SUPABASE_URL: "https://test-flowpay.supabase.co",
  SESSION_LOOKUP_URL: "https://test-flowpay.supabase.co/functions/v1/flowpay-session-lookup",
  SESSION_LOOKUP_SECRET: "s".repeat(32)
};
function run(env) {
  return spawnSync(process.execPath, [script], {
    env: { PATH: process.env.PATH || "", ...env },
    encoding: "utf8",
    timeout: 5000
  });
}
test("smoke probe fails safely without configured secrets", () => {
  const result = run({ FLOWPAY_STAGING_SMOKE_TEST: "I_CONFIRM_STAGING_ONLY" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /required staging configuration is missing/);
  assert.doesNotMatch(result.stderr + result.stdout, /https?:\/\//);
});
test("smoke probe refuses to run without staging-only opt-in", () => {
  const result = run(base);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /explicit staging-only confirmation required/);
  assert.doesNotMatch(result.stderr + result.stdout, /s{32}/);
});
test("smoke probe rejects a nonmatching confirmation value", () => {
  const result = run({ ...base, FLOWPAY_STAGING_SMOKE_TEST: "true" });
  assert.equal(result.status, 2);
});
