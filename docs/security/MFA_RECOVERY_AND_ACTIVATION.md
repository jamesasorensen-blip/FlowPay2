# FlowPay MFA recovery and activation checklist

**Policy update, 2026-11-13:** the user selected recovery by the app owner alone. [MFA_OWNER_RECOVERY.md](MFA_OWNER_RECOVERY.md) is authoritative and supersedes two-reviewer requirements in the historical checklist below. Owner-mode code is prepared and tested, but recovery is not deployed; independently authenticated owner authority, durable cases/audit and a live drill remain required.

Status: **NOT ENABLED**. This document is a design and operational checklist, not an implemented automated recovery feature.

## Safe recovery policy

Supabase TOTP does not provide native downloadable recovery codes. Do not treat a password reset, email link, local PIN, or browser-stored value as an MFA bypass.

1. Encourage users to enroll a second authenticator factor on a separate device before launch.
2. For a lost device, a user who still has another verified factor signs in at AAL2 and replaces the lost factor.
3. For loss of all factors, use a tightly controlled manual account-recovery process: suspend sensitive access; verify ownership independently with more than email or password alone; require a second authorized reviewer; log the request, evidence category, reviewers, time and actions without retaining identity documents unnecessarily; revoke existing sessions; reset factors through documented administrator operations; and require fresh TOTP enrollment before data access. **No such administrative workflow is implemented yet.**
4. Never put Supabase service-role credentials in the frontend, Cloudflare browser code, or GitHub.

## Activation gates

- [ ] Confirm all three existing test accounts can enroll TOTP and complete AAL2 login.
- [ ] Implement and validate the manual recovery process, including auditing and session revocation.
- [ ] Add AAL2 enforcement to every production data API and applicable Supabase RLS policy; test AAL1 denial and AAL2 success.
- [ ] Verify that account A cannot access account B's financial records, including cached browser state.
- [ ] Test sign-out, token refresh, enrollment interruption, second factor enrollment, lost-factor replacement, and recovery.
- [ ] Deploy and test staging independently of production.
- [ ] Enable the enforcement switch only after all checks pass.

The staging Worker flag `REQUIRE_MFA_AAL2` is off by default. Enabling a frontend-only switch is not sufficient authorization.

## Operational recovery controls (design; not a self-service bypass)

- **Before launch:** designate two authorized recovery reviewers and a secure, access-controlled case/audit system. A single operator must not be able to approve their own recovery request.
- **Intake:** create a case ID and record user ID, request timestamp, claimed lost factor(s), and current access status. Do not collect TOTP secrets, backup codes, passwords, or full identity documents in support tickets.
- **Verification:** independently validate identity through pre-established, high-assurance evidence and a separate communication channel. A signed-in AAL1 session, password reset, email inbox access, or Plaid account details alone are insufficient.
- **Approval:** second reviewer records approval and evidence category; reject unclear cases. Protect audit logs from alteration.
- **Reset:** use the documented, privileged Supabase administrative workflow from a restricted backend/operator environment only; record factor IDs and actions, not secrets. Revoke sessions and confirm revoked sessions cannot reach financial APIs. Never expose an administrative reset endpoint to an AAL1 browser session.
- **Re-enrollment:** require a fresh sign-in and TOTP enrollment, confirm an AAL2 token, then re-enable financial access. Notify the account owner through an established channel.
- **Negative tests:** wrong identity, missing second approval, reused/revoked session, replayed request, unknown factor, and cross-account reset must all fail without disclosing account details.

**Blocker:** No audited two-person recovery service, secure case system, or revocation verification exists yet. This runbook is not evidence that recovery is operational.

## Backend enforcement regression coverage

The staging Worker exports `requiresMfa` for unit tests, which verify AAL1 denial and AAL2 allowance for financial routes when `REQUIRE_MFA_AAL2=true`. These tests are necessary but **not sufficient**: verify real HTTP requests against the deployed staging Worker using signed AAL1 and AAL2 test sessions, confirm `/me` exposes no financial data, and verify token revocation behavior. Do not enable the flag on a shared environment until a tested recovery procedure exists.
