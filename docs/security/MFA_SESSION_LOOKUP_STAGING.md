# FlowPay staging session lookup: deployment gate

Status: **source code only; not deployed, not activated**. The Supabase project is shared with production. Never turn on `REQUIRE_ACTIVE_SESSION` or `REQUIRE_MFA_AAL2` in production as part of staging validation.

## Architecture

The staging Cloudflare Worker verifies JWT signatures and claims, then (when `REQUIRE_ACTIVE_SESSION=true`) calls a private Supabase Edge Function over HTTPS. The Edge Function uses a server-only Postgres connection to query `auth.sessions` for the supplied JWT `session_id`. It returns the session owner and expiry, but no refresh tokens, email, or financial data. The Worker checks that the returned session belongs to the signed JWT subject. A missing, expired, revoked, or mismatched session is rejected. No positive-result caching is allowed.

## Prerequisites (do not skip)

1. Provision a distinct, random, high-entropy 32+ character `FLOWPAY_SESSION_LOOKUP_SECRET` as a **Supabase Edge Function secret**, and the identical value as the staging Worker's `SESSION_LOOKUP_SECRET`. Do not commit it or send it in chat.
2. Configure `SUPABASE_DB_URL` for the Supabase Edge Function with a server-only Postgres connection authorized to SELECT only `id`, `user_id`, and `not_after` from `auth.sessions` if possible. Use least-privilege credentials; never expose this URL to browsers or the public Worker response.
3. Configure `FLOWPAY_STAGING_TEST_USER_ID` for the Edge Function to the single approved staging test account. This is **mandatory** because the Supabase project is shared with production.
4. Deploy the *new, uniquely named* Edge Function `flowpay-session-lookup` with `verify_jwt=false` **only because the function authenticates every POST using its own bearer secret**. Do not disable JWT verification for any other Edge Function.
5. Configure the staging Worker's `SESSION_LOOKUP_URL` to the exact HTTPS function URL, and `SESSION_LOOKUP_SECRET` to the matching secret. Never configure these variables on production.
6. Confirm unauthorized calls return 401; invalid/missing configuration returns 503; an unknown session returns `active:false`; and a known active **staging** session returns its correct user ID.
7. Only after end-to-end tests pass, set `REQUIRE_ACTIVE_SESSION=true` on staging. Test active, revoked, wrong-user, and database-unavailable paths. Check that financial endpoints fail closed, while `/me` remains available for enrollment.
8. Keep `REQUIRE_MFA_AAL2=false` until account recovery, dual authorization, durable audit, and a real locked-out-user recovery drill are completed.

## Important limitations

- Supabase's signed JWT may remain cryptographically valid after sign-out; the financial API must check the authoritative session row for immediate revocation.
- The Edge Function is reachable over the internet, but requires the private bearer secret; do not describe it as network-private. Protect the secret, monitor failed authorization, and rotate it on suspicion of exposure.
- An Edge Function deployed into the shared Supabase project is a live project change even when staging-only; confirm all secrets and allowlist restrictions before deploying.
- Supabase MFA recovery execution is still a design with injected trusted verification, one-time claim, audit, and session-revocation callbacks. These callbacks are **not** operational services.
- Do not claim mandatory MFA is live or account recovery is available until all activation gates are independently verified.
