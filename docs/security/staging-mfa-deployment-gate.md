# Staging-only MFA candidate deployment gate

**Latest checkpoint (2026-11-13):** the real disposable-session revocation drill passed through PR #58's staging panel: the same unexpired token was rejected with `SESSION_INVALID` after session-local sign-out. Restored version `1e59c637-0dce-47fe-9673-8dc35f537567` is Ready at 100% traffic; both enforcement flags are false. Positive lookup and live revoked-session rejection are verified. Reauthentication, outage and lost-device recovery checks remain pending. See the live validation runbook for exact versions and evidence.

## Current state correction — 2026-11-13

**Later authorized live test:** temporarily enabled active-session enforcement, confirmed authenticated cloud and Sandbox-account reads succeeded, then restored the flag to false. Current restored version is `e85b7432-f47f-4c1c-b821-5741438a3b82` (Ready, 100% traffic). Positive authenticated server-to-server transport is now verified; live unknown/revoked-session and recovery gates remain pending. See the live validation runbook for test version and scope.

Read-only inspection of Cloudflare's active `00303e2b` editor source confirms that staging **already contains the integrated MFA/session-gate implementation**, with helpers inlined. Earlier statements that staging lacks this integration are superseded. No deployment was performed during this inspection. Both new enforcement flags remain false and the legacy alias is absent.

The normalized source snapshot is `cloudflare/snapshots/staging-worker-00303e2b.mjs` (SHA-256 `de74c794a30af2242587d28598a863513eeedcbedb5c3764a3ec29ad61756922`). Its body beginning at `const PLAID_URL` matches the reviewed candidate exactly after trailing-whitespace normalization. All 50 Worker regression tests pass against the snapshot, including signed assurance, forged-token rejection, both MFA flag aliases, revoked/foreign/expired/unavailable sessions, enrollment bootstrap and financial routes. These are offline executions of captured live code, not evidence of live authenticated lookup or enabled gates. The source/helper suite passes 67 tests and the bundle passes 50.

The connected browser also confirmed that anonymous `/me` and `/user-data` return Unauthorized, while the existing signed-in staging frontend reaches Cloud synced and loads Sandbox accounts and transactions. This establishes current normal browser connectivity; it does not test the authoritative session service with its shared secret. Complete the live authenticated transport, disposable-session revocation and recovery gates before enabling enforcement. Do not redeploy merely to install code already present.

**Preparation only.** This document does not authorize or execute a deployment, change production configuration, or merge PR #57.

## Deployment target

- Worker: `flowpay-plaid-api-staging` ONLY; do not change `flowpay-plaid-api` or any production route.
- Source: `cloudflare/candidates/main-worker-mfa-integration.mjs` from the reviewed commit of `review/staging-mfa-integration-20261112`.
- The candidate imports `../mfa-session-check.mjs` and `../supabase-session-lookup.mjs`; a deploy artifact must bundle those imports correctly. Do not paste the candidate source alone into the dashboard editor.
- Retain staging D1 bindings, Plaid sandbox bindings, webhook routing and scheduled job configuration. Confirm staging Worker has no production route.
- Existing shared Supabase Edge Function is ACTIVE and must **not** be redeployed for this step.

## Required staging settings (check effective values, not just presence)

| Variable | Required effective staging value |
| --- | --- |
| `REQUIRE_ACTIVE_SESSION` | `false` or unset |
| `REQUIRE_MFA_AAL2` | `false` or unset |
| `REQUIRE_AAL2` (legacy alias) | `false` or unset |

**Important:** `REQUIRE_AAL2=true` independently activates the MFA gate even if `REQUIRE_MFA_AAL2=false`. Check all three before deployment and after deployment. Do not change any production flags.

Keep the staging-only `STAGING_TEST_USER_ID` binding; the candidate rejects other user identities. The following existing staging configuration names must remain present: `SUPABASE_URL`, `SESSION_LOOKUP_URL`, `SESSION_LOOKUP_SECRET`, and applicable D1/Plaid sandbox secrets. Do not print values.

## Operator preflight

1. Verify all CI workflows pass for the exact candidate commit and record that SHA.
2. Inspect staging Worker routes, deployment version, D1 binding, scheduled triggers, and Plaid environment. Record a rollback version ID before any change.
3. Confirm the three effective enforcement values above. Confirm the Supabase lookup URL points to the configured Supabase project and shared credentials match using secret managers without disclosing values.
4. Verify the intended dedicated test account matches the private allowlist and staging test-user binding.
5. Build the candidate with its imported modules using the existing Cloudflare bundler/deployment process; inspect the bundle for unintended files or secret literals.
6. Obtain explicit approval for the **specific staging deployment action** and execute only on the staging Worker. Do not deploy to production.

## Postdeployment validation (flags still disabled)

1. Check staging Worker version and confirm production Worker version unchanged.
2. Confirm staging `/me` works with a valid test token and rejects missing or invalid tokens. Never log tokens.
3. Run the read-only authenticated unknown-session smoke test from an approved staging server environment; expect `active:false`.
4. Check Plaid sandbox webhook and scheduled sync regressions without touching production.
5. If any test fails, roll back staging to the recorded version; leave all MFA gates disabled.

**Not yet performed:** live authenticated lookup, candidate staging deployment, or postdeployment tests.

## Read-only checkpoint — 2026-11-13

- Confirmed review branch bundle commit `c385affde29cdd5a010c3532b663b1d77373793b` is pushed. Its frontend, application-security, and candidate-review workflows passed.
- Cloudflare dashboard reports active staging version prefix `00303e2b`, at 100% traffic. This supersedes the older `c316faee` observation; obtain the full rollback version before deployment.
- Effective `REQUIRE_ACTIVE_SESSION=false` and `REQUIRE_MFA_AAL2=false`; legacy `REQUIRE_AAL2` is absent from the runtime variable table.
- `PLAID_ENV=sandbox`, D1 binding `DB` targets `flowpay-plaid-db-staging`, and the dedicated staging test-user binding is present. The scheduler runs every minute.
- The staging Worker URL is enabled; no custom domains or zone routes are configured. Session lookup URL targets the configured function path; secret values were not revealed or compared.
- Re-ran 66 source/helper security regressions successfully. Added execution of the same 49 Worker regressions against `staging-mfa-bundled.mjs`; all passed. CI now triggers on bundle changes and syntax-checks/tests the deployment artifact.
- No deployment, flag change, session revocation, or shared-project modification was performed. Authenticated transport, test-identity mapping, recovery and live session checks remain pending.
