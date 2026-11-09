# FlowPay Information Security Policy — DRAFT

Status: Proposed; not yet approved or operationally verified. Owner: FlowPay operator. Review cadence: annually and after material incidents.

## Scope and principles
Covers FlowPay code, banking integrations, cloud infrastructure, authentication, logs, backups, consumer financial data, contractors and administrators. Apply least privilege, deny-by-default, separation of production and test environments, MFA for privileged access, and secure handling of credentials.

## Access control and identity
Use individual accounts; never share privileged credentials. Grant access based on documented role and business need. Privileged production access requires MFA. Review access quarterly and immediately after personnel changes. Record who approved access, date, system, role, and removal date. Revoke departing users' sessions, API tokens, keys, deploy access and credentials immediately on termination, and change access promptly on transfer. Automated identity lifecycle management is a target control, not yet verified.

## Data protection
Use HTTPS/TLS for transit and encryption at rest for sensitive records and backups. Keep secrets in managed environment secrets, not source code or browser code. Restrict production bank-token decryption to the Cloudflare Worker. Do not log tokens, credentials, full bank account numbers, or unnecessary personal data.

## Secure development
Review changes before production release. Run dependency vulnerability checks on pull requests and weekly. Patch critical exploitable vulnerabilities within 72 hours, other critical within 7 calendar days, high within 14, medium within 30, low within 90, unless documented risk acceptance approved by the operator. These are proposed SLAs; effectiveness requires issue tracking and evidence. Maintain a component inventory and review EOL status quarterly. Remove or upgrade unsupported runtimes.

## Monitoring and incidents
Review authentication anomalies, API failures, access changes, vulnerability alerts and audit logs at least weekly. Record incidents, scope, timeline, containment, recovery and notification decisions. Rotate exposed secrets immediately. Preserve evidence without copying sensitive data into tickets.

## Privacy and retention
Collect only data needed for stated functions, honor withdrawal of consent, provide disconnection and deletion paths, and maintain a data inventory and deletion schedule. Do not equate consent withdrawal with erasure.

## Vendor and business continuity
Review Cloudflare, Supabase, Render, Plaid and GitHub security features and relevant contract terms annually. Maintain restore procedures, encrypted backups where applicable, and test recovery at least annually.

## Approval record
Approver: PENDING
Effective date: PENDING
Next review: PENDING
