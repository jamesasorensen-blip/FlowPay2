# Plaid security attestation evidence register

**Important:** A checked attestation is not independent verification. Status below describes evidence currently observed, not certification.

| Requirement | Status | Evidence / remaining action |
|---|---|---|
| Published privacy policy | OPEN | Draft exists; approve, publish, link in UI |
| RBAC | PARTIAL | Authenticated per-user Worker; verify cloud roles and role matrix |
| Vulnerability scanning | PARTIAL | Proposed npm audit workflow; verify runs and broaden scope |
| Consent tracking | TESTED | Production consent grant, withdrawal and 403 tests |
| EOL management | PARTIAL | Node 18 replaced with 24; inventory and periodic reviews needed |
| Encryption in transit | PARTIAL | HTTPS URLs observed; TLS configuration audit needed |
| Deletion and retention policy | OPEN | Draft; retention periods and actual deletion paths require validation |
| Secure tokens and certificates | PARTIAL | Worker JWT and encrypted Plaid tokens; rotate leaked legacy secret |
| Centralized IAM | PARTIAL | Supabase Auth for users; internal cloud IAM unverified |
| Periodic access reviews | OPEN | Policy template; no completed review evidence |
| MFA internal | OPEN | Enable/verify MFA on GitHub, Cloudflare, Supabase, Render, Plaid |
| Documented access control | PARTIAL | Draft policy; approval and actual enforcement unverified |
| Automated deprovisioning | OPEN | Requires identity lifecycle integration or tested automation |
| Encryption at rest | PARTIAL | Plaid tokens encrypted in Worker; audit D1, backups and all stores |
| Information Security Policy | PARTIAL | Draft; approval and implementation evidence required |
| Patch SLA | PARTIAL | Proposed SLA; tracking and actual patch evidence required |
| Consumer MFA | OPEN | Supabase MFA enrollment/enforcement not verified |
| Zero trust | PARTIAL | Auth/consent checks; broader architecture and verification required |

## Immediate incident follow-up
Legacy server.js contained a hardcoded Plaid secret in Git history. Current production source no longer contains it, but **rotate/revoke that credential in Plaid**, update any dependent Cloudflare/Render secrets, verify new credentials, and review usage logs. Git history and previously cloned copies remain sensitive.

Supabase security advisor reported leaked-password protection disabled. Enable and verify it if supported by the project's plan.

Do not mark OPEN/PARTIAL requirements as compliant until controls are operational and evidence is collected.
