# FlowPay staging session lookup: deployment gate

Status: **source code only; not deployed, not activated**. The Supabase project is shared with production. Never turn on `REQUIRE_ACTIVE_SESSION` or `REQUIRE_MFA_AAL2` in production as part of staging validation.

## Architecture

The staging Cloudflare Worker verifies JWT signatures and claims, then (when `REQUIRE_ACTIVE_SESSION=true`) calls a private Supabase Edge Function over HTTPS. The Edge Function uses a server-only Postgres connection to query `auth.sessions` for the supplied JWT `session_id`. It returns the session owner and expiry, but no refresh tokens, email, or financial data. The Worker checks that the returned session belongs to the signed JWT subject. A missing, expired, revoked, or mismatched session is rejected. No positive-result caching is allowed. Do not substitute a KV/cache binding for the authoritative Supabase lookup.

## Prerequisites (do not skip)

1. Provision a distinct, random, high-entropy 32+ character `FLOWPAY_SESSION_LOOKUP_SECRET` as a **Supabase Edge Function secret**, and the identical value as the staging Worker's `SESSION_LOOKUP_SECRET`. Do not commit it or send it in chat.
2. Configure `SUPABASE_DB_URL` for the Supabase Edge Function with a server-only Postgres connection authorized to SELECT only `id`, `user_id`, and `not_after` from `auth.sessions` if possible. Use least-privilege credentials; never expose this URL to browsers or the public Worker response.
3. Confirm the database role and its permissions are independently reviewed before deploying. The shared production database must not be queried using unnecessarily broad credentials. Configure `FLOWPAY_STAGING_TEST_USER_ID` for the Edge Function to the single approved staging test account. This is **mandatory** because the Supabase project is shared with production.
4. Deploy the *new, uniquely named* Edge Function `flowpay-session-lookup` with `verify_jwt=false` **only because the function authenticates every POST using its own bearer secret**. Do not disable JWT verification for any other Edge Function.
5. Configure the staging Worker's `SESSION_LOOKUP_URL` to the exact HTTPS function URL, and `SESSION_LOOKUP_SECRET` to the matching secret. Never configure these variables on production.
6. Confirm unauthorized calls return 401; invalid/missing configuration returns 503; an unknown session returns `active:false`; and a known active **staging** session returns its correct user ID.
7. Only after end-to-end tests pass, set `REQUIRE_ACTIVE_SESSION=true` on staging. Test active, revoked, wrong-user, and database-unavailable paths. Check that **all authenticated endpoints**, including `/me`, reject revoked or unverifiable sessions. A valid AAL1 session may still access `/me` for MFA enrollment.
8. Keep `REQUIRE_MFA_AAL2=false` until account recovery, dual authorization, durable audit, and a real locked-out-user recovery drill are completed.

## Important limitations

- Supabase's signed JWT may remain cryptographically valid after sign-out; the financial API must check the authoritative session row for immediate revocation.
- The Edge Function is reachable over the internet, but requires the private bearer secret; do not describe it as network-private. Protect the secret, monitor failed authorization, and rotate it on suspicion of exposure.
- An Edge Function deployed into the shared Supabase project is a live project change even when staging-only; confirm all secrets and allowlist restrictions before deploying.
- Supabase MFA recovery execution is still a design with injected trusted verification, one-time claim, audit, and session-revocation callbacks. These callbacks are **not** operational services.
- Do not claim mandatory MFA is live or account recovery is available until all activation gates are independently verified.

## Restricted database credential plan (reviewed, NOT APPLIED)

Read-only verification on the shared Supabase project confirms PostgreSQL 17.11 and that neither `authenticated` nor `service_role` currently has SELECT on `auth.sessions`. Do **not** grant either client role that permission.

Use a dedicated `LOGIN` role with a separately generated strong password. Have a database administrator execute the following **only after a change review**, ideally on an isolated Supabase development branch first. This is an example for manual review, not an automatic migration:

```sql
-- Execute using a privileged database administrator; replace the password
-- through a secure SQL session, never in GitHub, chat, or SQL editor history.
begin;
create role flowpay_session_lookup LOGIN NOINHERIT
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
  PASSWORD '<GENERATE_AND_INSERT_SECURELY>';
grant usage on schema auth to flowpay_session_lookup;
grant select (id, user_id, not_after) on auth.sessions
  to flowpay_session_lookup;
commit;
```

Use a Postgres connection string with **this role**, not `postgres` or `service_role`, as the Edge Function's server-only `SUPABASE_DB_URL`. Select the connection endpoint and pooler mode using the Supabase dashboard's Connect instructions, and verify connectivity without logging credentials. The deployed function additionally restricts queries to the single staging test user. Do not run the example SQL until a staging branch or reviewed maintenance window exists.

Permission acceptance queries (run as database administrator; do not display credentials):

```sql
select
  has_schema_privilege('flowpay_session_lookup','auth','USAGE') as can_use_auth,
  has_column_privilege('flowpay_session_lookup','auth.sessions','id','SELECT') as can_read_id,
  has_column_privilege('flowpay_session_lookup','auth.sessions','user_id','SELECT') as can_read_user_id,
  has_column_privilege('flowpay_session_lookup','auth.sessions','not_after','SELECT') as can_read_expiry,
  has_column_privilege('flowpay_session_lookup','auth.sessions','factor_id','SELECT') as can_read_other_column;
```

The first four results must be true and the last must be false **if that extra column exists**; choose an actual other column from `information_schema.columns` if necessary. Also verify the role cannot read `auth.users`, `auth.mfa_factors`, or unrelated financial tables. An actual connection as the role must successfully execute the three-column lookup and be denied when attempting to select unauthorized columns/tables. These checks are not yet executed because the role is not created.

## Secret configuration (ready for operator entry, NOT SET)

1. Generate a fresh random value of at least 32 bytes using a local password manager's cryptographically secure generator. **Never share it in chat or commit it.**
2. In Supabase Dashboard → Edge Functions → Secrets, create `FLOWPAY_SESSION_LOOKUP_SECRET` with that value. This is a project-level Edge Function secret: do not reuse a Plaid or production API key.
3. In **staging Cloudflare Worker only**, add `SESSION_LOOKUP_SECRET` with the exact same value. Do not set this on the production Worker.
4. Add `FLOWPAY_STAGING_TEST_USER_ID` to Supabase Edge Function secrets using the already-approved test account UUID. Never put production user IDs here.
5. Add `SUPABASE_DB_URL` to Supabase Edge Function secrets **only after** the dedicated restricted database role has been provisioned and verified.
6. Configure `SESSION_LOOKUP_URL` in the staging Worker as `https://<project-ref>.supabase.co/functions/v1/flowpay-session-lookup`. Keep `REQUIRE_ACTIVE_SESSION` and `REQUIRE_MFA_AAL2` disabled until live tests pass.
7. Deploy the uniquely named function and test unauthorized, revoked, active, wrong-user, and outage behavior. Because this Supabase project is shared with production, deployment must be explicitly reviewed before activation.

The secret name and handling plan are finalized. The credential and role are **not** created, the secret is **not** set, and the Edge Function is **not** deployed.
