# Owner-managed MFA recovery

Selected by James Sorensen on 2026-11-13: **the app owner handles recovery**, without a second reviewer. This supersedes earlier two-reviewer rollout requirements. It does not enable a public MFA reset or deploy administrative recovery.

## Authority and scope

- Configure `mode: "owner"` and the verified owner principal as `ownerOperatorId` in trusted backend configuration. Do not take these settings from a browser request, recovery case or email.
- The owner must authenticate to a separate, MFA-protected administrative control plane. An existing FlowPay session, Google/email access or password alone does not authorize a reset. Owner identity must be independently bound to the real control-plane principal and project permissions.
- `executeMfaRecovery` additionally requires `verifyOwnerAuthority` and trusted case verification before inventory access or any privileged action. Case approval must come from that same configured owner. Owner verification is required even for dry runs.
- The owner may recover their own FlowPay account using separately verified administrative access. Do not depend on the lost FlowPay authenticator for that administrative access. Keep its separate backup/recovery method secure.
- The legacy two-reviewer mode remains the fail-closed default for existing callers. Owner mode must be explicitly wired from trusted configuration; a case's own `mode` field cannot select it.

## Procedure

1. Try an existing verified backup authenticator first. Never remove working factors to simulate an incident.
2. Create a private, uniquely identified case for the exact account. Confirm that no usable backup remains. Record evidence references and the independent identity-verification method; retain no OTPs, seeds, passwords or identity-document copies in the case.
3. Notify the account through its established channel and allow cancellation/escalation. Retain the existing 48-hour waiting period. Owner approval must be affirmative, documented, issued after the request, and less than 24 hours old at execution.
4. Authenticate the owner through the separate administrative control plane. Verify exact account/factor inventory and the authoritative case. Run the executor in its default dry-run mode first.
5. For a real reset, durably claim the case once and record audit intent before deleting any reviewed factor. Stop on audit failure, stale inventory, replay, partial deletion or unclear authorization. Never retry a partial reset automatically.
6. Revoke/verify all sessions for that recovered account. Previously issued signed access tokens must be rejected by authoritative session checks. Require fresh sign-in and enrollment, then AAL2 verification before restoring financial access.
7. Notify the user of completion and record the final audit references and outcome. Do not globally disable MFA or grant a temporary browser bypass.

## Deployment status

Implemented and offline-tested: owner-mode preflight, independent owner-verification requirement, one owner approval, existing claim/audit/inventory/revocation safeguards, and dry-run default.

Prepared and verified in isolated PostgreSQL: `docs/owner-recovery-store-draft.sql` and `cloudflare/owner-recovery-store.mjs`. The new private schema uses an empty-by-default singleton database-role-to-owner binding, RLS with no browser grants, immutable approval/audit history, server-assigned timestamps, conditional one-time claims and atomic claim/audit recording. The adapter compares submitted cases to authoritative records and uses parameterized SQL. Test dependencies are pinned separately under `tools/recovery-store-tests`; they are not frontend/application dependencies.

**Not deployed or operational:** verified live control-plane owner binding, deployment/configuration of the tested private store and restricted database login, privileged recovery service integration, and a disposable-account end-to-end reset/re-enrollment drill. The old `mfa-recovery-private-schema-draft.sql` enforces two reviewers and must not be applied as an owner-mode implementation. The new owner draft has not been applied either. No shared schema or permission changes accompany this work.

Before deployment, confirm the dedicated login's real `session_user` (including pooler behavior), prove that the schema is not exposed through the Data API, review owner authority outside the lost FlowPay session, and retain external audit monitoring. The database owner can bypass trigger protections; append-only enforcement here constrains runtime access.

No existing authenticator was removed, no session revoked, and no production or shared Supabase setting changed during implementation. A live reset requires review of the exact disposable account and explicit authorization for that action.
