# FlowPay MFA recovery and rollout gate (draft — NOT enabled)

**Current policy, 2026-11-13:** owner-managed recovery was selected by the user. See [MFA_OWNER_RECOVERY.md](security/MFA_OWNER_RECOVERY.md); its owner-authentication and single-owner-approval requirements supersede the historical two-reviewer requirements below. Recovery remains undeployed. Existing authenticators must remain intact.

## Current policy
- Production mandatory MFA must remain **off** until all gates below pass.
- Existing enrolled users retain both authenticators. Never remove a factor to simulate recovery.
- The staging and production frontend share a Supabase project: treat Auth changes as potentially production-impacting.
- The staging Worker restricts financial APIs to the allowlisted test user and can enforce `aal2` with `REQUIRE_MFA_AAL2=true`. Only change this on the staging Worker, with an explicit rollback to `false`.

## Recovery requirements before enforcement
1. Prefer an already enrolled second TOTP factor. Test challenge with the backup authenticator while retaining the primary.
2. For users who lose **all** factors, build a documented manual recovery process. A password or access to email alone is insufficient proof for removing MFA.
3. Recovery requests require authenticated support intake, identity verification using previously established signals, and two independent authorized reviewers; never accept an unverified caller's claim.
4. Store a minimal, access-controlled recovery case record: user ID, request timestamp, verification method, reviewer identities, decision, actions, and notification timestamp. Do not record TOTP seeds, codes, access tokens, or bank credentials.
5. Notify the user using a pre-existing verified channel when recovery is requested and again when completed. Introduce a waiting period and a cancellation/escalation path for suspicious requests.
6. An approved recovery must use a restricted administrative operation, scoped to the exact user and factors. Revoke all existing sessions, require fresh sign-in, and require new factor enrollment before financial API access. Do not globally disable MFA or silently whitelist recovered users.
7. Rate-limit and monitor recovery attempts. Test denial, duplicate requests, interrupted operations, notification failures, and audit trails in a non-production account.
8. Publish user-facing support instructions and staff procedures; designate authorized reviewers and an escalation contact. Do not claim recovery is available until staffed and exercised.

## Authenticated staging enforcement test plan
Prerequisites: known rollback operator, staging-only Worker variable access, a test account with verified primary and backup factors, and ability to obtain two **separate valid** JWTs for the same test user: an `aal1` session before completing MFA and an `aal2` session after verification. Do not paste JWTs into chat, issues, logs, or CI.

1. Verify `REQUIRE_ACTIVE_SESSION=true`, staging sandbox credentials, and test-user allowlist.
2. Confirm the test user's active `aal2` session can access `GET /me` and `GET /user-data`.
3. Enable `REQUIRE_MFA_AAL2=true` **only on the staging Worker**.
4. Confirm valid `aal1` gets `200` on `GET /me` (identity only) and `403` with `MFA_REQUIRED` on `GET /user-data`.
5. Confirm valid `aal2` gets `200` on `GET /me` and `GET /user-data`.
6. Confirm expired/revoked JWT gets `401` regardless of AAL.
7. Immediately roll back to `REQUIRE_MFA_AAL2=false` if any login, enrollment, or recovery path is broken; retest staging dashboard.
8. Record only HTTP statuses and sanitized results, never credentials or financial response bodies.

## Release gates
- [x] Primary authenticator enrollment and MFA login tested manually
- [x] Backup authenticator enrollment reported successful
- [x] Unit and anonymous live API tests passed in CI
- [ ] Live authenticated AAL1/AAL2 financial API tests passed
- [ ] Backup authenticator used in a fresh MFA challenge
- [ ] Staffed, audited, two-reviewer recovery built and tested
- [ ] Existing-user enrollment grace period and notices implemented
- [ ] Production RLS and all data access paths audited for AAL2 enforcement
- [ ] Rollback drill, monitoring, and support readiness completed

**Never enable production mandatory MFA solely because the staging Worker gate passes.**
