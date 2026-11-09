# FlowPay MFA recovery and activation checklist

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
