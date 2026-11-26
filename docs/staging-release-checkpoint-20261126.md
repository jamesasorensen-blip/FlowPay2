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

## Post-restore verification
Supabase now reports ACTIVE_HEALTHY. Read-only inspection confirms:
- public.manual_budgets and flowpay_session_private.allowed_user exist with RLS enabled.
- Budget SELECT/INSERT/UPDATE policies enforce owner_id = auth.uid(), aal2 and an authoritative active session. UPDATE has both USING and WITH CHECK.
- Private lookup checks the allowed_user list, session ID and expiry. Functions pin search_path to empty.
- Only the restricted flowpay_session_lookup role can execute lookup_active_session among tested app roles. Anonymous/authenticated roles cannot execute it or read its private allowlist.
- Anonymous role has no SELECT privilege on manual_budgets.
- A synthetic unknown session returns zero rows.
- Lookup role is non-superuser, has no BYPASSRLS, and currently cannot log in.
- Two Auth users exist; private allowed_user has zero rows. No user identities or credentials were exported.
- No Edge Functions deployed.

Advisor findings:
- INFO: private allowed_user has RLS with no policies. Keep this deny-by-default design; do not add browser policies merely to silence this notice.
- WARN: leaked-password protection disabled. Review availability and enable on staging as part of the Auth configuration phase.

## Phase 2 preparation
1. Identify the intended staging test user by email, verify it exists in this separate project, then propose its allowlist entry. No production identity copying.
2. Prepare a staging-only database login with only the private lookup privilege; provision its password and a separate Worker-to-function shared secret using server-side secret tools. Never put secret values in chat, docs, browser assets or git.
3. Review/deploy flowpay-session-lookup only to zaynpzvhrskeierplvwj after credentials are available. Test unauthorized, unknown, expired, revoked and allowed sessions before enabling the Worker gate.
4. Capture current frontend/Worker configuration for rollback; change staging issuer, lookup URL, credentials and test-user restriction together. Do not change the production issuer or bindings.
5. Validate sign-in/enrollment/recovery, AAL1 denial, AAL2 access, account isolation and Sandbox Link/sync.
Blocked inputs: designated test account email; secure backend credential provisioning/Cloudflare access; reconciliation with unpublished VS Code Phase 2 work. No schema, policy, allowlist, secret or runtime deployment changes made by these post-restore checks.
