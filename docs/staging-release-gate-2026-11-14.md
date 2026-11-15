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

## Verified preview failure diagnosis (2026-11-15)

Read the signed-in Cloudflare dashboard logs for commit `5ea9522`:

| Service | Build | Observed configuration/result |
| --- | --- | --- |
| flowpay-api | d762813d-9c10-42c8-af4f-ecd3b5b0a04b | Root `/`, no build command, deploy `npx wrangler preview`; dependencies install successfully, Wrangler 4.162.0 fails because configuration lacks a `previews` block. |
| flowpay2 | 9c4bdccc-e6e1-4775-9c2e-e76b17c71ef9 | Same root, commands, Wrangler version, and missing-`previews` failure. |

Both dashboard views identify the service environment as Production, while these builds use the review branch. This does not establish that either service is the deployed banking staging Worker. Do not blindly add root-level Wrangler configuration or retry a deployment: first map these services to their intended roles, verify production/non-production build commands and branch rules, and verify resource isolation. The separately protected staging Worker upload/promotion flow remains authoritative. No build was retried and no service setting was changed during this investigation.

Official reference: https://developers.cloudflare.com/workers/previews/configuration/

All five GitHub check jobs passed on `5ea9522`: smoke-test, worker-isolation, server-security, pwa, and npm-audit. These checks do not verify hosted deployment behavior.

## Service mapping and source drift (2026-11-15, read-only dashboard inspection)

| Service | Verified hosting role | Active version / source | Data binding |
| --- | --- | --- | --- |
| flowpay-api | Static assets only; not the banking API despite its name | 0252b949; main commit dda276bfb2d0d9f2282a0e704eb1cd3b24468fc1 | No runtime bindings; dashboard says runtime variables/bindings cannot be added to static-only Workers |
| flowpay2 | Static assets only | 8a174b0d; same main commit | No runtime bindings |
| flowpay-plaid-api-staging | Banking staging Worker, PLAID_ENV=sandbox | 1e59c637 at 100%; latest deployment message updates REQUIRE_ACTIVE_SESSION | DB -> flowpay-plaid-db-staging |
| flowpay-plaid-api | Separate banking Worker | 9adf6250 at 100% | DB -> flowpay-plaid-db |

The two banking DB links have different database IDs, confirming D1 binding separation. This does not verify secret-value separation, Supabase project separation, schema parity, or deployed-source parity.

Both static frontend services have production branch main and production deploy command `npx wrangler deploy`, root /, no build command. The flowpay2 Previews Base tab has preview branch builds enabled and preview command `npx wrangler preview`, root /, no build command or build variables. The flowpay-api production build settings include Plaid sandbox build variable/secret names; secret values were not revealed. Do not copy those build secrets into a frontend bundle. No settings were saved and no build or deployment was triggered manually.

### Staging security configuration drift — deployment blocker

The staging runtime settings show:
- REQUIRE_ACTIVE_SESSION=false
- REQUIRE_MFA_AAL2=false
- PLAID_ENV=sandbox
- STAGING_TEST_USER_ID configured (value deliberately omitted here)
- SESSION_LOOKUP_URL configured to a Supabase session-lookup function
- Session-lookup secrets, SUPABASE_URL, Plaid credentials, and token-encryption key are marked encrypted.

The reviewed repository Worker uses REQUIRE_AAL2 and has no REQUIRE_ACTIVE_SESSION/REQUIRE_MFA_AAL2 handling. This is evidence of configuration/source drift, not proof of the deployed authorization behavior. The active version is not linked to the current review commit. Do not promote this source over staging until the deployed code is inspected and its session-revocation/MFA logic reconciled and tested. Do not toggle flags blindly: enrollment/recovery and server-side session lookup must be verified first.

### Concrete next work

1. Inspect the active staging source using the protected inspection workflow and compare its authentication/session logic with the reviewed source.
2. Reconcile source and setting names with regression coverage for revoked sessions, AAL1 denial, AAL2 success, and failed lookup.
3. Prepare a separate static-only preview package/configuration using an explicit allowlist of public assets. Do not point static assets at the repository root or attach banking secrets/bindings.
4. Validate that package locally before wiring preview settings; keep main/production deployment unchanged.
