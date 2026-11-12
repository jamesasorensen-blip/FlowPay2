# Staging authoritative session lookup: implementation contract

Status: **design only; not deployed or approved for production**.

## Why this is required

The Worker adapter in `cloudflare/supabase-session-lookup.mjs` expects a server-side POST endpoint at `/functions/v1/flowpay-session-lookup`. The current repository does **not** contain that Edge Function. The adapter and mock tests do not establish that a real Supabase session was verified.

## Proposed request/response contract

- Request: `POST`, JSON `{"session_id":"<UUID>"}`, server-to-server only.
- Authentication: dedicated `SESSION_LOOKUP_SECRET` transmitted in the Authorization header, verified in constant time where practical; never expose to browser, logs, or repository.
- Success (active): `{"active":true,"session":{"id":"<UUID>","user_id":"<UUID>","not_after":null}}`. Only these fields may be returned.
- Missing, revoked, expired: `{"active":false}`. Return no user metadata.
- Misconfigured, unauthorized, or unavailable: non-2xx, no session metadata. Never infer active status from JWT claims alone.
- Responses: `Cache-Control: no-store`; strict POST-only behavior, JSON size limit, no redirects, no public CORS.
- Rate-limit and audit failed authentication attempts without logging session IDs or secrets.

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
- Deploy the endpoint only to a confirmed nonproduction environment.
- Test from the staging Worker with `REQUIRE_ACTIVE_SESSION=false` and `REQUIRE_MFA_AAL2=false` until readiness checks pass.
- Enable gates in staging one at a time after recovery and rollback are proven.
- Do not merge PR #57 as a production MFA implementation; it is a review checkpoint.
