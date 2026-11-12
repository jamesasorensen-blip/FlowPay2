# Staging-only MFA candidate deployment gate

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
