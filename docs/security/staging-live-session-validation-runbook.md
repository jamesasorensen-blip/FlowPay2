# Staging-only authoritative session lookup validation

**Status:** operator checklist, **not** authorization to deploy, enable MFA, rotate secrets, or modify the shared Supabase project.

**2026-11-13 correction:** the active staging source at version prefix `00303e2b` already contains the reviewed candidate's Worker body with inlined helpers. See `staging-mfa-deployment-gate.md` and the captured source under `cloudflare/snapshots/`. Earlier “candidate not deployed” statements below describe an outdated checkpoint and must not be used as the current deployment state. Enforcement remains disabled; authenticated lookup/revocation/recovery validation is still pending.

## Authorized live positive-session test — 2026-11-13

- User explicitly approved temporarily enabling `REQUIRE_ACTIVE_SESSION` on `flowpay-plaid-api-staging`, testing the existing signed-in session, then restoring `false`.
- Deployed the variable-only test version `0a22c68a-35a4-4ca7-be1a-0cb01aeb9dbc` with `REQUIRE_ACTIVE_SESSION=true`. No source or credential was changed.
- Opened the existing authenticated staging frontend in a fresh tab. It reached **Cloud synced**. Opening Bank Connections reached **Sandbox bank connections ready** and rendered test accounts without `SESSION_INVALID`. Given the captured active source's fail-closed gate on those routes, this verifies a successful authoritative lookup through the configured server-to-server credential for the current allowed test session. No credential or session ID was extracted.
- Restored `REQUIRE_ACTIVE_SESSION=false` through variable-only version `e85b7432-f47f-4c1c-b821-5741438a3b82`, observed Ready at 100% traffic. Confirmed `REQUIRE_MFA_AAL2=false` and that the staging frontend still reached Cloud synced after reload.
- This supersedes the pending **positive authenticated transport** gate above. It does not prove unknown-session or revoked-session rejection through the live service, outage handling, or lost-device recovery; those remain pending. No session was revoked, no financial data was changed, and no production Worker or shared Supabase configuration was modified.

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
- **User confirmation (2026-11-12):** all financial data across FlowPay site/app versions is outdated and does not need to be preserved. This is not authorization to delete data, rotate credentials, or deploy changes. The Supabase account used for testing is dedicated to tests.
- **Operator-confirmed Supabase Edge Function secret presence (2026-11-12):** `SUPABASE_DB_URL`, `FLOWPAY_SESSION_LOOKUP_SECRET`, and `FLOWPAY_STAGING_TEST_USER_ID` all exist. Values and matching credentials have not been inspected; runtime authentication is unverified.
- **Operator-confirmed Cloudflare staging Worker configuration (2026-11-12):** the variable names `SUPABASE_URL`, `SESSION_LOOKUP_URL`, and `SESSION_LOOKUP_SECRET` are all present on `flowpay-plaid-api-staging`. Values, endpoint identity, shared-secret equality, and deployed Worker code were **not** inspected. Presence does not establish working integration.
- **Read-only identity integrity check:** the sole allowlisted UUID resolves to exactly one existing `auth.users` record; the same user has two session rows, both with no passed `not_after` cutoff. This verifies database referential consistency, **not** that the account is the intended staging identity or that a session is authenticated.
- Independent mapping between the intended staging test account and allowlisted UUID is still pending.
- **Additional read-only permission check:** `anon` and `authenticated` cannot execute `flowpay_session_private.lookup_active_session(uuid)`; restricted role `flowpay_session_lookup` can execute it. The allowlist still contains one user and two session rows, both without a passed `not_after` cutoff (this alone does not prove an active authenticated session).
- **Not yet verified:** allowlist-to-test-account UUID mapping; runtime secret presence/matching; a live authenticated lookup; or revocation behavior. Session-row count alone is not proof that either session is currently valid.
- **Hold:** do not run a positive or revoked-session test or enable any enforcement flag until test-account ownership and isolation are confirmed.

## Safe server-to-server smoke-test gate (no credentials in chat or GitHub)

### Read-only live checkpoint — 2026-11-13

- Review commit `25abd333c396fda91e0d67bb0ffec4b7bd72b0dd` passed all three GitHub workflows: frontend #313, application security #495, and candidate security #38 (including deployment-bundle execution).
- The single database allowlist entry matches the staging Worker test-user binding observed in Cloudflare. That user exists. This establishes binding-to-database consistency; it does not establish a fresh authenticated login or independent account ownership.
- The dedicated account currently has three session rows. Calling the real private lookup for those rows returned matching metadata for all three; none had a passed `not_after` cutoff. A random unknown session returned no row. No identifiers were returned to logs or written to this evidence record.
- `anon` and `authenticated` cannot execute the private lookup. The restricted lookup role can execute it, cannot SELECT `auth.sessions` directly, and has neither superuser nor RLS-bypass privilege. The connector cannot impersonate that role (`SET ROLE` was denied), so successful execution using its actual connection credentials remains unverified. No grants were changed.
- The deployed Edge Function remains ACTIVE v3. Live unauthenticated GET returned 405; POST with no bearer returned 401; POST with an intentionally invalid, nonsecret bearer returned 401. All three responses had `Cache-Control: no-store`, no CORS allow-origin header, and no session metadata.
- HTTP probes to the staging Worker from the execution host were rejected with Cloudflare error 1010 (plain-text 403), including the trusted-origin preflight. These are **inconclusive for Worker authentication and CORS**; do not record them as application test passes or change CORS based on them.
- Render discovery found four staging static sites and the production web service. None is an existing staging server runtime for this credentialed smoke test; do not place secrets on a static site or the production server to work around this.
- No credentials were retrieved, no sessions were revoked, and no deployments or enforcement settings were changed. Remaining live gates: authenticated Edge Function transport with the existing shared secret, dedicated-account login/ownership confirmation, disposable-session revocation, candidate deployment, and end-to-end recovery/rollback validation.

The **review candidate is not deployed**. Do not interpret results from the current staging Worker as evidence that its candidate integration is active.

1. Confirm the staging Worker code version and that its `SESSION_LOOKUP_URL` targets exactly `https://<project-ref>.supabase.co/functions/v1/flowpay-session-lookup` for the same project as `SUPABASE_URL`; check values only inside authorized secret managers.
2. Confirm the Supabase `FLOWPAY_SESSION_LOOKUP_SECRET` and staging Worker `SESSION_LOOKUP_SECRET` match using an authorized server-side operator process; never print, paste, hash into logs, or commit either value.
3. Confirm the single `flowpay_session_private.allowed_user` entry is the intended staging test identity and `FLOWPAY_STAGING_TEST_USER_ID` matches it, without exposing the UUID.
4. Only from an approved staging-only server runtime, call the Supabase function with an **invalid random UUID** and the server credential. Expect `200 {"active":false}`. This validates the authenticated transport and fail-closed unknown-session behavior without touching any real session. Record only status and boolean outcome.
5. From that same runtime, call using a valid dedicated test session. Expect `200 {"active":true}` with minimal metadata, then revoke **only that disposable test session** and verify `active:false`. Never log tokens, identifiers, or response metadata.
6. If any step fails, stop. Do not deploy the candidate or enable either enforcement flag. Preserve sanitized status codes and request times for review.

### Guarded unknown-session smoke probe

The repository includes `scripts/staging-session-lookup-smoke.mjs`. It is **not** run automatically by CI. CI only syntax-checks the file; never add production or staging secrets to GitHub Actions for this test.

Run it only from an approved staging server process that already has the three environment variables `SUPABASE_URL`, `SESSION_LOOKUP_URL`, and `SESSION_LOOKUP_SECRET` provisioned through its secret manager. Set `FLOWPAY_STAGING_SMOKE_TEST=I_CONFIRM_STAGING_ONLY` in that process's configuration and invoke `node scripts/staging-session-lookup-smoke.mjs`. Do not paste secret values into command arguments, shell history, or chat. The script emits a sanitized PASS/FAIL and uses a random UUID; it does not test a valid session or revocation. A PASS is **not** proof that the Cloudflare candidate is deployed or that MFA enforcement works.

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
