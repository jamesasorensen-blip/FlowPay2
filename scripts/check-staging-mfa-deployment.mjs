// Static predeployment guard. No network access, secrets, or deployment.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const source = readFileSync(fileURLToPath(new URL("../cloudflare/candidates/main-worker-mfa-integration.mjs", import.meta.url)), "utf8");
const checks = [
  ["active-session enforcement is opt-in", /env\.REQUIRE_ACTIVE_SESSION\s*===\s*"true"/],
  ["MFA enforcement is opt-in", /env\.REQUIRE_MFA_AAL2\s*===\s*"true"/],
  ["legacy MFA alias is recognized", /env\.REQUIRE_AAL2\s*===\s*"true"/],
  ["staging identity restriction is present", /user\.id\s*!==\s*env\.STAGING_TEST_USER_ID/],
  ["session lookup uses server-side adapter", /createSupabaseSessionLookup\(env\)/]
];
let failed = false;
for (const [label, pattern] of checks) {
  const pass = pattern.test(source);
  console.log(`${pass ? "PASS" : "FAIL"}: ${label}`);
  failed ||= !pass;
}
if (failed) process.exitCode = 1;
