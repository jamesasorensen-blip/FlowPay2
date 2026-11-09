# Mandatory MFA rollout (not yet enabled)

## Current state
The staging Worker supports an opt-in REQUIRE_MFA_AAL2 environment flag, default OFF. Never enable until users can enroll and verify TOTP and recover their accounts. /me remains available to identify the current assurance level. All other Worker endpoints require a signed, verified Supabase JWT with aal=aal2 when the flag is true.

## Required before rollout
1. Implement Supabase TOTP enroll, challenge, verify and factor management in the frontend. Show enrollment for users with no verified factors and challenge for returning users. Keep recovery secure; support second enrolled factor or verified support recovery.
2. Audit all production and staging API routes and Supabase RLS policies; enforce aal2 for financial data. This Worker flag alone does not protect direct database access or other backends.
3. Test in isolated staging accounts: new user enroll, existing user enroll, correct/incorrect TOTP, aal1 denial, aal2 access, expired JWT, token tampering, factor removal, lost-device recovery, logout and refresh.
4. Verify all existing users can enroll; communicate the requirement and recovery steps. Enable in staging first; monitor 403 MFA_REQUIRED and successful sign-ins. Enable production only after passing end-to-end tests.

## Rollback
Set REQUIRE_MFA_AAL2 to false on the Worker to temporarily restore pre-enforcement behavior if rollout fails. Do not delete user accounts or factors. Keep a secure support recovery process.
