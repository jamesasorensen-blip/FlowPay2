# MFA recovery case record (two-person approval)

**Status:** Manual procedure only. Do not reset a factor solely on the basis of a support email, password, or existing AAL1 session. This is not an automated recovery service.

## Required case fields
- Case ID (unique, immutable):
- User ID (from trusted admin view; never supplied by email alone):
- Request time and reason:
- Identity verification evidence references (do not store document scans, codes, or secrets here):
- Independent verification method and outcome:
- Approver A identity, time, and approval:
- Approver B identity, time, and approval (different human from A):
- Verified factor IDs selected for removal:
- Admin operator identity and time:
- Supabase admin operation result and audit reference:
- Session invalidation verification:
- User notification reference:
- Successful re-enrollment and AAL2 verification:
- Closure time and reviewer:

## Procedure
1. Open a case and identify the account through trusted internal records. Verify identity through an independent established recovery channel. Email/password control by itself is insufficient.
2. Obtain two independent approvals and record them before privileged action. Deny self-approval.
3. Review all existing verified factors; prefer the user authenticating with a second already-enrolled factor instead of administrator reset.
4. If no factor is available, a privileged operator uses Supabase Auth admin MFA factor deletion for **only the reviewed user and factor IDs**. Never expose the service-role key to the browser or a public recovery endpoint. Supabase documents that deleting a verified factor logs out the user's active sessions.
5. Verify revocation behavior and consider already-issued access JWTs valid until expiry unless the protected backend additionally checks session validity. For sensitive operations, do not assume factor deletion instantly invalidates an existing signed JWT at the Worker.
6. Notify the user via a previously verified channel, require new factor enrollment, verify AAL2, and record the outcome.
7. Retain an immutable audit trail in the organization's approved system and periodically review recovery cases.

## Release blockers
- [ ] Two distinct trained operators with verified identities and a secure case/approval system.
- [ ] Tested identity-verification policy and escalation for unavailable channels.
- [ ] Privileged recovery tooling restricted to authorized operators; no public reset route.
- [ ] Immutable case and operator audit logs with documented retention.
- [ ] Verified session revocation or backend session-state checks, including already-issued JWTs.
- [ ] Test recovery on a disposable staging account, including denied single-approval and wrong-user attempts.
- [ ] Confirm enrollment and challenge works after recovery.
- [ ] Confirm users receive advance notice and support instructions before mandatory MFA activation.

**Never activate mandatory MFA solely because automated unit tests pass.**
