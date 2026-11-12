# Staging MFA integration review — 2026-11-12

Status: **review only; no Worker deployment or enforcement changes authorized**.

## Verified repository state

- Base branch: `main` at `dda276bfb2d0d9f2282a0e704eb1cd3b24468fc1`.
- Security source branch: `security/mfa-staging-gate` at `cfa0536399757db02edb600336afab978fbd06c9`.
- Branches diverged: security is 203 commits ahead and 120 behind `main` (GitHub compare at review time).
- Security candidate exists at `cloudflare/candidates/staging-worker-security-reconciled.mjs` on the security branch, **not** on `main`.
- The source branch's `tests/staging-reconciled-worker-security.test.mjs` asserts signed AAL claims, invalid/revoked sessions, and preservation of banking/webhook/scheduler code against its own origin-fix candidate. These tests do **not** establish parity with the currently deployed staging Worker.
- Cloudflare build failures for production-named `flowpay-api` and `flowpay2` used `npx wrangler preview` without a required `previews` block. Do not substitute `wrangler deploy` without a reviewed production deployment plan.

## Observed staging state

The operator's read-only workflow inspection #20 reported:
- Worker `flowpay-plaid-api-staging`.
- D1 binding matched expected staging database, `PLAID_ENV` sandbox, and staging test-user restriction present.
- Active version `c316faee-d992-4a13-a7eb-bd9b6e9c5af3`.
- `changed: false`.

Re-inspect before any upload; do not assume the version is still active.

## Blockers to staging MFA activation

The source-branch document `docs/security/MFA_SESSION_LOOKUP_STAGING.md` explicitly marks the session lookup as **not deployed or activated**. It requires:
1. Independently reviewed, restricted DB role for read-only `auth.sessions` access (shared Supabase project).
2. Secret provisioning and staging-test-user restriction without exposing credentials.
3. Deployment and negative/positive verification of `flowpay-session-lookup`.
4. Tests for revoked, expired, foreign, unavailable and active sessions.
5. Only then consider `REQUIRE_ACTIVE_SESSION=true` **on staging**.
6. Keep `REQUIRE_MFA_AAL2=false` until recovery, audit, dual authorization and locked-out-user recovery drill are operational.

## Safe integration plan

1. Compare current `main` Worker and active staging Worker with the security branch's origin-fix baseline. Confirm webhook, Plaid sync, scheduler and bindings are preserved.
2. Port only reviewed MFA/session-gate code and its required helper modules/tests onto a new branch based on current `main`; avoid merging the divergent branch wholesale.
3. Run syntax, targeted security, banking/webhook, and staging regression tests; record exact commands and results.
4. Open a focused PR. Do not merge until checks and source parity pass.
5. Use the protected `Manage Cloudflare staging version` workflow to upload an undeployed candidate, inspect metadata, then separately approve promotion. Never deploy to production from this review.
6. Keep Antigravity dependency work on its own feature branch.

This file records a review plan only. It does not imply any test or live staging verification beyond the observations above.
