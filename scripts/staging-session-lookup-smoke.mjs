// Run only inside an authorized staging server environment. Never paste secrets
// into a terminal command, GitHub issue, browser console, or CI log.
// Required environment: SUPABASE_URL, SESSION_LOOKUP_URL, SESSION_LOOKUP_SECRET.
// This probe is read-only and intentionally uses an unknown UUID.
import { randomUUID } from "node:crypto";
import { createSupabaseSessionLookup } from "../cloudflare/supabase-session-lookup.mjs";

const required = ["SUPABASE_URL", "SESSION_LOOKUP_URL", "SESSION_LOOKUP_SECRET"];
if (required.some(name => !process.env[name])) {
  console.error("FAIL: required staging configuration is missing");
  process.exitCode = 1;
} else if (process.env.FLOWPAY_STAGING_SMOKE_TEST !== "I_CONFIRM_STAGING_ONLY") {
  console.error("SKIP: explicit staging-only confirmation required");
  process.exitCode = 2;
} else {
  try {
    const lookup = createSupabaseSessionLookup(process.env);
    const result = await lookup(randomUUID());
    if (result !== null) throw new Error("Unknown session was accepted");
    console.log("PASS: authenticated unknown-session lookup denied access");
  } catch {
    // Do not print errors: runtime errors can contain URLs or other sensitive context.
    console.error("FAIL: authenticated lookup unavailable or unsafe response");
    process.exitCode = 1;
  }
}
