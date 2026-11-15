# Staging release gate (2026-11-14)

This document records verified evidence and outstanding checks. Passing unit tests does **not** establish readiness for production.

## Verified in GitHub Actions

- Frontend checks and Docker build: successful on commit `bd76c5a2752cacb6b4ecaec4e061791653850a11` (run 43623420564).
- Application security regression: successful on that commit (run 43623420598).
- PWA install regression: successful on that commit (run 43623420618).
- Dependency security scan: successful on that commit (run 43623420570).
- Local Python inspection/version-management suite: all 24 tests passed; now included in normal pull-request CI as well as the protected manual workflows.
- Frontend routes block private repository files and retire legacy `/api` endpoints; regression coverage added in this PR.

## Must verify against deployed staging before promotion

- [ ] Confirm the deployed Cloudflare Worker revision matches the reviewed source.
- [ ] Confirm the actual `REQUIRE_AAL2` setting; verify that AAL1 financial requests are denied and AAL2 requests succeed. Do not enable the gate before existing users have tested enrollment and recovery.
- [ ] Confirm staging secrets and database bindings are distinct from production, without printing secret values.
- [ ] Exercise MFA enrollment, sign-in, backup authenticator, recovery and account switching on staging.
- [ ] Exercise Plaid Sandbox consent, link, webhook receipt, paginated sync, duplicate delivery, and failed-sync recovery on staging.
- [ ] Verify two separate accounts cannot access one another's connections, transactions, or balances.
- [ ] Check staging logs for errors after these scenarios without copying tokens or personal financial records.
- [ ] Confirm guest workspace cannot call financial APIs and cannot read authenticated data.
- [ ] Verify mobile installation, responsive layout, and browser compatibility against the deployed staging URL.
- [x] Commit the CI-generated dependency lockfile and use `npm ci` for frontend CI, security scans, and Docker builds. The lockfile candidate came from successful frontend run 43616980913 at commit `b4f13f44e25860f7fcbf00f8215897aadacd0d97`.
- [ ] Review and approve the draft PR only after the above gates are complete.

## Supabase advisor findings (2026-11-14)

Read-only advisor scan of connected FlowPay Supabase project:
- **WARN security:** leaked-password protection disabled. Enable through Auth settings after verifying plan/availability and account policy. Reference: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
- **INFO security:** `flowpay_session_private.allowed_user` has RLS enabled without policies. Review intent; do not add permissive policies merely to clear this notice.
- **WARN performance (3), inspected:** `public.manual_budgets` policies `manual_budget_read`, `manual_budget_insert`, and `manual_budget_update` were inspected using read-only `pg_policies`. All already wrap `auth.uid()` and `auth.jwt()` in scalar `SELECT` expressions, and require both `owner_id` ownership and JWT `aal2`. The advisor warnings may be false positives or reflect another planner detail; no policy changes are warranted without an execution-plan-based diagnosis. Reference: https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan
- [ ] Determine whether the connected Supabase project is staging, production, or shared before any database/auth configuration changes. The connected project is ACTIVE_HEALTHY and its Supabase branch list is empty (read-only verification on 2026-11-14); this does not prove separation or sharing. Do not alter authentication settings or RLS until the environment mapping is established.

## Deployment configuration evidence (2026-11-14)

- The repository frontend workflow uses Node 24, installs locked dependencies with `npm ci`, runs `npm test`, and builds the Docker image.
- The Dockerfile uses Node 24 Alpine and `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`. The committed lockfile is explicitly copied and included in the Docker build context.
- No root-level `render.yaml`, `wrangler.toml`, or `wrangler.jsonc` was found in the default branch. Absence of these files does **not** establish the actual deployed service configuration; settings may live in the hosting dashboards.
- [ ] Confirm actual Render and Cloudflare deployment revision, environment bindings, and separation before live verification.

## Release discipline

Keep this PR in draft until checks are complete. Do not merge or deploy to production automatically.

## Preview build finding

The Cloudflare integration reports failed preview builds for `flowpay2` and `flowpay-api` on commit `b4f13f4`. These are separate from the three successful GitHub Actions workflows. Preview hosting remains unverified; do not claim deployed staging readiness from CI results.

## Request body limits (staging source only)

The Worker now enforces request body byte limits while reading the stream, before accumulating the full payload. Existing JSON limits (4 KiB by default and 512 KiB for cloud writes) remain in place. Webhooks use a 64 KiB byte limit and return HTTP 413 when exceeded. This prevents multibyte text or requests without Content-Length from bypassing the intended limits. Five regression tests cover exact boundaries, early cancellation, split UTF-8, interrupted streams, and oversized webhook rejection before external/database work. Local validation: all 140 Node tests and 55 explicit banking isolation/sync checks passed. This source has not been deployed to staging or production.

## Signing-key cache isolation (staging source only)

Cached JWKS entries are now bound to the exact configured Supabase issuer. Each request retains its own cache snapshot while verifying its token. A synthetic regression reproduced acceptance of project-B claims signed with a previously cached project-A key when both keys used the same key ID and configuration changed within the same module instance; the fixed source rejects it. Repeated sign-ins still reuse the same issuer's cache, and a new key ID triggers refresh. This test does not establish that live deployments share a runtime or that any live account was affected.

Validation: all 142 Node tests, 55 explicit banking checks, and 24 Python safeguards passed locally. Prior commit `d19bffb6819d0bf783e65d3a2b96d6406275ebe9` passed all four GitHub workflows. No hosted Supabase configuration, authentication settings, or Worker deployments were changed. Reference: https://supabase.com/docs/guides/auth/jwts

## Request encoding follow-up (2026-11-15, staging source only)

The bounded request reader now rejects malformed or truncated UTF-8 with HTTP 400 rather than silently replacing bytes inside financial JSON. It preserves an initial byte-order mark in raw text so webhook verification does not hash a normalized body; JSON parsing rejects that mark. Malformed webhook encoding returns 400 before Plaid or database work. Regression cases cover invalid bytes, split and truncated sequences, BOM byte preservation, and webhook rejection.

Verified the prior head `0e0254f` has successful GitHub checks for smoke-test, worker-isolation, server-security, PWA, and dependency audit. Cloudflare's two preview builds still report failure; their hosting state is not established by successful GitHub checks. Local follow-up validation: full Node suite passed (145 tests), all 8 focused request-reader tests passed, 55 banking contract/isolation checks passed, and 24 Python deployment safeguards passed. No live service, database, authentication setting, or production deployment changed.

The user explicitly authorized uploading this follow-up on 2026-11-15. The connected GitHub app was used because command-line git had no credentials. No live service or production deployment was changed.
