# Staging release checkpoint — 2026-11-26 UTC

## Verified
- Signed-in frontend deployed at https://flowpay-staging.onrender.com from fcc601bdc1c4424cf561c770f17e404a39299366, including guest UI changes.
- Prior combined frontend checks: 249 passed, 1 authenticated staging probe skipped. These were offline checks, not evidence of live Plaid acceptance.
- Deployed staging frontend still configures original Supabase Auth project sdiovjwtphqvfjlyoxeq.
- Separate project FlowPay Staging (zaynpzvhrskeierplvwj) exists but Supabase currently reports INACTIVE.
- Supabase connector lists no Edge Functions in that separate staging project; security advisors currently return no findings. Inactive-project advisor output does not replace a live database audit.
- No Cloudflare management credential is available in this execution environment.
- Requests from this execution environment to the staging banking Worker return HTTP 403 with "error code: 1010". This is an inconclusive Cloudflare access block, not a verified CORS, session, or banking application failure.

## Release blockers
1. Restore the separate staging Auth project and verify its existing Phase 1 schema/Auth settings before modifying them.
2. Reconcile the VS Code-only Phase 1/Phase 2 work with this deployed frontend; do not overwrite its unpublished work.
3. Prepare and verify the private authoritative session-lookup function and required server-side credentials in the staging project. Nothing is deployed by this checkpoint.
4. Wire staging frontend and banking Worker to the same staging Auth issuer and fresh staging test identity. Do not reuse production identities or credentials.
5. Read the active Worker version/source, D1 binding, Sandbox setting, allowed origins, MFA/session flags and secret names through authenticated Cloudflare access. Preserve newer banking/webhook/scheduler code.
6. Verify AAL1 denial, AAL2 success, revocation/sign-out, lookup outage handling, recovery and cross-account isolation against the deployed candidate.
7. Complete Sandbox Link, repeated/interrupted sync, deduplication, reconnect, webhook, consent withdrawal and deletion acceptance using synthetic data.
8. Validate the final Docker/runtime candidate and production privacy/security/monitoring/rollback checklist.
9. Obtain explicit approval before production deployment or enabling real-bank access.

## Next staging action
Restore FlowPay Staging (zaynpzvhrskeierplvwj), then inspect the recovered settings/schema and the VS Code Phase 2 proposal. Do not enable strict session enforcement before its lookup service is verified healthy.

## Scope
Read-only hosted inspection only. No project restoration, schema/Auth changes, secret changes, function/backend deployment, real bank linking or production changes were made. This checkpoint does not declare production readiness.

## Authorized restoration follow-up
User approved the next staging step. Supabase accepted the restore request for zaynpzvhrskeierplvwj. Subsequent status polls report COMING_UP, with no failure returned. Database/schema verification must wait for ACTIVE_HEALTHY. No schema, Auth configuration, credentials, Edge Functions, Cloudflare settings or production resources were changed by the restoration request.
