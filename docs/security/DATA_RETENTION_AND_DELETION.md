# FlowPay Data Retention and Deletion — DRAFT

Status: Proposed. Actual database, vendor, log and backup retention settings must be inventoried and verified before this policy is approved.

Data categories: Supabase identity records, bank connection metadata and encrypted Plaid tokens in Cloudflare D1, bank accounts and transactions, consent and security audit records, app data, cloud provider logs and backups.

- Consent withdrawal: stop new bank connections, bank reads and synchronization; existing records are not automatically erased.
- Bank disconnect: revoke the associated Plaid Item when supported and delete or de-identify stored bank connection records according to the verified application workflow.
- Account deletion: authenticate and verify the requester, delete app and banking records across systems, revoke provider tokens, and delete identity records, subject to legal retention exceptions.
- Logs: minimize personal data, restrict access, and define retention according to actual platform settings.
- Backups: document provider retention, deletion propagation and exceptions; do not promise instant deletion from backups without verification.
- Retention schedule: **PENDING** for each category until inventory and legal requirements are reviewed; do not invent fixed periods.

Deletion evidence: record request ID, verified identity, systems processed, exceptions, completion timestamp and operator, without logging secrets.

Tests required: account deletion, bank disconnect and token revocation, re-authentication prevention, log/backup retention review and cross-system deletion validation.
