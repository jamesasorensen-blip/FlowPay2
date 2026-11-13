# MFA recovery case record (app-owner approval)

Current authority: [MFA_OWNER_RECOVERY.md](MFA_OWNER_RECOVERY.md), selected 2026-11-13. Use the configured, separately authenticated app owner; do not accept a requester-supplied owner identity.

**Status:** Manual procedure only. Do not reset a factor solely on the basis of a support email, password, or existing AAL1 session. This is not an automated recovery service.

## Required case fields
- Case ID (unique, immutable):
- User ID (from trusted admin view; never supplied by email alone):
- Request time and reason:
- Identity verification evidence references (do not store document scans, codes, or secrets here):
- Independent verification method and outcome:
- Configured owner principal and independent control-plane authentication reference:
- Owner identity, time, and documented approval:
- Verified factor IDs selected for removal:
- Admin operator identity and time:
- Supabase admin operation result and audit reference:
- Session invalidation verification:
- User notification reference:
- Successful re-enrollment and AAL2 verification:
- Closure time and reviewer:

## Procedure
1. Open a case and identify the account through trusted internal records. Verify identity through an independent established recovery channel. Email/password control by itself is insufficient.
2. Obtain the configured owner's documented approval through independently authenticated administrative access. The same owner operates the recovery; an ordinary FlowPay session or requester assertion cannot substitute for owner verification. Retain the 48-hour wait and approval freshness requirements.
3. Review all existing verified factors; prefer the user authenticating with a second already-enrolled factor instead of administrator reset.
4. If no factor is available, a privileged operator uses Supabase Auth admin MFA factor deletion for **only the reviewed user and factor IDs**. Never expose the service-role key to the browser or a public recovery endpoint. Supabase documents that deleting a verified factor logs out the user's active sessions.
5. Verify revocation behavior and consider already-issued access JWTs valid until expiry unless the protected backend additionally checks session validity. For sensitive operations, do not assume factor deletion instantly invalidates an existing signed JWT at the Worker.
6. Notify the user via a previously verified channel, require new factor enrollment, verify AAL2, and record the outcome.
7. Retain an immutable audit trail in the organization's approved system and periodically review recovery cases.

## Release blockers
- [ ] Verified app-owner control-plane binding and secure private case/approval system.
- [ ] Tested identity-verification policy and escalation for unavailable channels.
- [ ] Privileged recovery tooling restricted to authorized operators; no public reset route.
- [ ] Immutable case and operator audit logs with documented retention.
- [ ] Verified session revocation or backend session-state checks, including already-issued JWTs.
- [ ] Test recovery on a disposable staging account, including denied missing/foreign-owner approval and wrong-user attempts.
- [ ] Confirm enrollment and challenge works after recovery.
- [ ] Confirm users receive advance notice and support instructions before mandatory MFA activation.

**Never activate mandatory MFA solely because automated unit tests pass.**
