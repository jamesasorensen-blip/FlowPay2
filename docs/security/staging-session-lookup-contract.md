# Staging authoritative session lookup: implementation contract

Status: **review-only integration; the Supabase Edge Function is already active in the shared project, but the Cloudflare candidate is not approved or deployed for production**.

## Why this is required

The Worker adapter in `cloudflare/supabase-session-lookup.mjs` expects a server-side POST endpoint at `/functions/v1/flowpay-session-lookup`. The repository now contains a source snapshot of the active Edge Function at `supabase/functions/flowpay-session-lookup/index.ts`. The adapter and mocked tests do not establish that a real Supabase session was verified.

## Observed Supabase state (read-only inspection, 2026-11-12)

The connected FlowPay Supabase project already has an **ACTIVE** `flowpay-session-lookup` Edge Function (version 3, `verify_jwt=false`). Its handler uses a dedicated bearer secret, an allowlisted staging user ID, and a private Postgres function. Therefore the earlier statement that no Edge Function exists applies only to this repository's source tree, **not** to the deployed project. The deployed handler was copied into reviewed source control as a snapshot, without deploying changes.

Read-only database inspection confirmed that `flowpay_session_private.lookup_active_session(uuid)` is `SECURITY DEFINER` with an empty search path and a session-ID-bound lookup. It checks `flowpay_session_private.allowed_user`. The `flowpay_session_lookup` role is not superuser, cannot bypass RLS, and has no direct `auth.sessions` SELECT or `auth` schema USAGE, but can execute the private lookup. The allowlist table has RLS enabled and no policies; only `postgres` appears in its table ACL. These observations do not establish that runtime secrets, connectivity, or revocation tests pass.

Supabase security advisors also reported leaked-password protection disabled; review enabling it separately. Do not include credentials, actual session IDs, or user data in GitHub.

## Outstanding verification

- Confirm deployed Edge Function source matches reviewed repository source and identify deployment ownership.
- Check required environment variable **presence only**, never disclose values.
- Confirm the allowlisted staging test account is distinct from production users.
- Exercise authenticated success, revoked session, invalid credential, and outage cases using test accounts.
- Confirm `not_after` semantics and whether session revocation immediately removes rows.
- Keep both enforcement flags disabled until end-to-end tests and recovery work.

## Proposed request/response contract

- Request: `POST`, JSON `{"session_id":"<UUID>"}`, server-to-server only.
- Authentication: dedicated `SESSION_LOOKUP_SECRET` transmitted in the Authorization header, verified in constant time where practical; never expose to browser, logs, or repository.
- Success (active): `{"active":true,"session":{"id":"<UUID>","user_id":"<UUID>","not_after":null}}`. Only these fields may be returned.
- Missing, revoked, expired: `{"active":false}`. Return no user metadata.
- Misconfigured, unauthorized, or unavailable: non-2xx, no session metadata. Never infer active status from JWT claims alone.
- Responses: `Cache-Control: no-store`; strict POST-only behavior, JSON size limit, no redirects, no public CORS.
- Rate-limit and audit failed authentication attempts without logging session IDs or secrets.

## Supabase Edge Function authentication compatibility

Supabase's Edge Functions platform checks `Authorization: Bearer <user JWT>` by default when `verify_jwt=true`. The existing Worker adapter instead sends `Authorization: Bearer <dedicated shared secret>`, which is **not a user JWT** and would be rejected before the function handler runs.

For this proposed dedicated-secret contract, set `[functions.flowpay-session-lookup] verify_jwt = false` in a reviewed per-function configuration **only when implementing the service**, then authenticate every request inside the function using the dedicated secret. Disabling the platform JWT check without implementing strong handler authentication is unsafe. Do not substitute the Supabase service-role key as a bearer JWT. An alternative design using the documented service-to-service `apikey` scheme requires a corresponding Worker adapter change and a separate review.

Source: https://supabase.com/docs/guides/functions/auth-headers

## Database least privilege: prerequisite, not a migration to run blindly

The lookup must query the authoritative `auth.sessions` data for **only** `id`, `user_id`, and `not_after`, restricted by a bound session ID. Verify the actual Supabase schema and revocation semantics first. Do not grant broad access to `auth`, use the `service_role` key in the browser, or expose `auth.sessions` through a public API.

A dedicated restricted database role or tightly scoped security-definer function must be reviewed by an operator with access to the real Supabase project. A security-definer function requires a fixed `search_path`, schema-qualified objects, restricted EXECUTE permissions, and a reviewed owner. Staging must not be allowed to mutate shared production authentication records.

## Required integration tests before enabling flags

1. Valid current session and matching user succeeds.
2. Signed JWT whose session was revoked fails.
3. Expired session, missing session, wrong user, malformed response fail.
4. Lookup timeout, invalid credentials, rate limit and database outage fail closed.
5. AAL1 account can reach the minimal MFA enrollment/bootstrap endpoint, but not financial endpoints.
6. AAL2 user can access permitted financial endpoints after active-session verification.
7. Existing Plaid webhooks and scheduled sync continue to operate with their separate authentication model.
8. MFA enrollment, challenge, lost-device recovery, and rollback are exercised with dedicated test accounts.

## Deployment hold points

- Confirm actual Supabase project and schema; do not assume staging has a separate auth database.
- Review database privileges and secret provisioning without printing secrets.
- Do not redeploy the already-active Edge Function in the shared Supabase project without explicit approval; require a confirmed nonproduction target for any future deployment.
- Test from the staging Worker with `REQUIRE_ACTIVE_SESSION=false` and `REQUIRE_MFA_AAL2=false` until readiness checks pass.
- Enable gates in staging one at a time after recovery and rollback are proven.
- Do not merge PR #57 as a production MFA implementation; it is a review checkpoint.
