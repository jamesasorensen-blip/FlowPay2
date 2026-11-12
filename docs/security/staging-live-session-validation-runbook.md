# Staging-only authoritative session lookup validation

**Status:** operator checklist, **not** authorization to deploy, enable MFA, rotate secrets, or modify the shared Supabase project.

## Scope and prerequisites

- The deployed Supabase `flowpay-session-lookup` function is ACTIVE (v3 at inspection on 2026-11-12) in a Supabase project also used by production. The source snapshot is in `supabase/functions/flowpay-session-lookup/index.ts`. Do not redeploy it as part of this checklist.
- The Cloudflare MFA integration in `cloudflare/candidates/main-worker-mfa-integration.mjs` is a review candidate, **not** a live staging integration.
- Keep `REQUIRE_ACTIVE_SESSION=false` and `REQUIRE_MFA_AAL2=false` until the complete checks, account recovery, and rollback are approved.
- Use a dedicated staging test account. Confirm its UUID is the **only** user in the private lookup allowlist. Do not query, revoke, or mutate production user sessions.
- Have an authorized operator check **presence and correct target** of `SUPABASE_DB_URL`, `FLOWPAY_SESSION_LOOKUP_SECRET`, and `FLOWPAY_STAGING_TEST_USER_ID` in Supabase; and `SUPABASE_URL`, `SESSION_LOOKUP_URL`, and `SESSION_LOOKUP_SECRET` in the staging Worker. Never paste values into GitHub, logs, screenshots, chat, or a browser console. The two secret variables must have the same value, but must be checked without disclosing that value.
- Confirm the staging Worker hostname and route, test-user ownership, and that the Worker actually runs the candidate integration **before** treating any endpoint response as an integration result.

## Read-only database checkpoint (2026-11-12)

- The deployed Edge Function is **ACTIVE version 3**, and its retrieved `index.ts` matches the repository snapshot **byte-for-byte** at this checkpoint. This confirms source parity, not runtime secret availability or live authentication.
- The private lookup allowlist currently contains **one user**.
- That allowlisted user currently has **two session rows** in `auth.sessions`.
- These counts were obtained without retrieving account or session identifiers and without modifying records.
- **Input-hardening follow-up:** the deployed handler parses JSON and destructures the result directly; a JSON `null` body currently reaches its catch-all 503 path rather than returning a client-input 400. This is a response-classification issue, not evidence of unauthorized access. Preserve the deployed-source snapshot and review any proposed fix separately before deployment.
- **User confirmation (2026-11-12):** the Supabase account used for FlowPay testing is a dedicated test account with no real financial data. Independent mapping between that account and the allowlisted UUID is still pending.
- **Additional read-only permission check:** `anon` and `authenticated` cannot execute `flowpay_session_private.lookup_active_session(uuid)`; restricted role `flowpay_session_lookup` can execute it. The allowlist still contains one user and two session rows, both without a passed `not_after` cutoff (this alone does not prove an active authenticated session).
- **Not yet verified:** allowlist-to-test-account UUID mapping; runtime secret presence/matching; a live authenticated lookup; or revocation behavior. Session-row count alone is not proof that either session is currently valid.
- **Hold:** do not run a positive or revoked-session test or enable any enforcement flag until test-account ownership and isolation are confirmed.

## Verification matrix (run only after prerequisites)

| Scenario | Expected result | Evidence to record |
| --- | --- | --- |
| No authorization header to Edge Function | 401; no session metadata | HTTP status, timestamp |
| Invalid bearer secret | 401; no session metadata | HTTP status, timestamp |
| Non-POST request | 405 | HTTP status |
| Malformed or oversized request with valid server credential | 400 or documented safe error; no metadata | HTTP status, sanitized category |
| Valid allowlisted staging session | 200, `active:true`, only `id`, `user_id`, `not_after` | Boolean pass/fail; **do not** record IDs |
| Revoked staging session | 200, `active:false` | Boolean pass/fail |
| Expired or unknown staging session | 200, `active:false` | Boolean pass/fail |
| Valid session belonging to another user | `active:false`; no other user's metadata | Boolean pass/fail; use authorized test accounts only |
| Database unavailable / lookup timeout | non-2xx, and Worker denies protected requests | HTTP status; no credentials |
| Staging Worker with AAL1 token and enabled gate (after approval) | MFA bootstrap remains accessible; financial routes denied | Route category and status |
| Staging Worker with AAL2 token and enabled gate (after approval) | Permitted financial route accessible; revoked token denied | Route category and status |
| Plaid webhook and scheduled sync | Existing independently authenticated behavior unaffected | Pass/fail and sanitized logs |

## Execution order

1. Record deployed versions, staging hostname, CI commit, and secret **presence only**. Check that staging is isolated from production and no actual user data will be accessed.
2. Run unauthenticated negative tests against the Edge Function only after verifying the correct endpoint and authorization to test. Never send the shared secret from a browser or an untrusted host.
3. Run authenticated positive and revoked-session tests **server-to-server** from an approved staging-only environment, with dedicated test credentials. Never store credentials in test fixtures.
4. Only after these pass, review deploying the Cloudflare candidate to a **staging-only** Worker. Test with both enforcement flags disabled first.
5. Review and approve one-at-a-time staging flag enablement, MFA enrollment, recovery, lost-device and rollback procedures. Never enable gates on a shared production route.
6. Attach sanitized evidence to PR #57; do not merge into main until separate production readiness review.

## Abort / rollback criteria

Stop if the staging endpoint resolves to a production route, a secret is missing, the allowlist is broader than the dedicated staging user, any production record is implicated, a revoked session is accepted, a request redirects to an unexpected host, or an outage permits protected financial access. Keep both gates disabled. Do not improvise changes to production auth or Supabase shared-project settings.

## Evidence record (no secrets or identifiers)

- Date/time (UTC):
- GitHub commit / CI run:
- Supabase function version:
- Cloudflare staging Worker version:
- Isolated staging account confirmed: yes/no
- Secret presence verified: yes/no (no values)
- Test scenario / result / expected:
- Sanitized log reference:
- Recovery and rollback verified: yes/no
- Reviewer approval for next stage: pending/approved
