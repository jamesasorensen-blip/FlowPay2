# Separate staging Auth cutover — prepared, not deployed

Target Supabase: FlowPay Staging, zaynpzvhrskeierplvwj.
Target frontend: flowpay-staging.onrender.com.
Target Worker: flowpay-plaid-api-staging.

This branch changes only the frontend Supabase URL and publishable browser key. No production code/settings or live frontend were switched. This branch must not be deployed by itself before backend acceptance.

Verified staging database has owner/AAL2/active-session RLS, private allowlisted lookup functions, no public lookup execution, two existing Auth users, and no allowlist entries. The requested tester email has no account in this project yet.

## Required backend preparation
- Reconcile unpublished VS Code Phase 2 work first.
- Create/configure a staging-only restricted database login permitted to execute flowpay_session_private.lookup_active_session. It must not be superuser or bypass RLS.
- Provision database connection and shared-secret values using server-side secret management; never paste them into chat, git or browser code.
- The Edge Function expects SUPABASE_DB_URL, FLOWPAY_SESSION_LOOKUP_SECRET, and FLOWPAY_STAGING_TEST_USER_ID.
- The Worker expects SUPABASE_URL, SESSION_LOOKUP_URL, SESSION_LOOKUP_SECRET and STAGING_TEST_USER_ID. Shared-secret values must match; the URL must be https://zaynpzvhrskeierplvwj.supabase.co/functions/v1/flowpay-session-lookup.
- Obtain authenticated read access to Cloudflare first; record current active version, bindings and flag settings for rollback.
- Keep Plaid Sandbox and the separate staging D1 binding. Preserve active newer banking/webhook/scheduler implementations.
- Verify the separate project's email sign-up/confirmation, site URL, redirect allowlist and TOTP settings before presenting registration. Never copy production accounts or credentials.
- Coordinate frontend/Worker issuer changes with an enrollment-safe path; financial endpoints remain closed until the new tester exists, is allowlisted, has verified MFA and the lookup service is healthy.
- Test unauthorized/unknown/revoked/expired/foreign sessions, AAL1 denial, AAL2 success and lookup outages before marking the gate ready.
- Only after this sign-in boundary passes, run Sandbox Link, sync/retry/reconnect/webhook/deletion and multi-account acceptance.

## Missing execution access
The current connected tools cannot provision Supabase function secrets or inspect/change Cloudflare Worker bindings. Use the authenticated VS Code tooling or dashboard for those operations, then return verification results without secret values.

Production deployment and real-bank access remain outside this cutover.
