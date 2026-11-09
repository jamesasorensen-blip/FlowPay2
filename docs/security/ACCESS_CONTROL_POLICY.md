# FlowPay Access Control and RBAC — DRAFT

Status: Proposed; platform enforcement and approval evidence not yet verified.

Roles:
- Owner / security administrator: manages cloud settings, secrets, deployments and incident response; MFA mandatory.
- Developer: creates pull requests and views non-production logs; production write access only when separately approved.
- Support: minimum user-support data access; no raw Plaid access tokens or production secrets.
- End user: accesses only their own financial data, subject to authentication and bank-data consent.

Rules: deny by default; unique identities; no shared admin accounts; separate staging and production; short-lived access where supported; secrets in managed vaults; access granted by named owner with recorded justification.

Joiner/mover/leaver process: record access request and approval; provision minimal role; on transfer remove unneeded roles immediately; on termination revoke provider sessions, repository permissions, Cloudflare, Render, Supabase, Plaid, and GitHub access and rotate shared secrets. Automated deprovisioning must be implemented and tested separately; a written process alone does not meet the automated requirement.

Quarterly review evidence template:
Date | System | Identity | Role | Business need | Reviewer | Decision | Action completed
---|---|---|---|---|---|---|---

Zero trust target: authenticate and authorize each request; verify ownership server-side; apply consent checks; limit network access; monitor privileged activity. This document does not claim a completed zero trust architecture.
