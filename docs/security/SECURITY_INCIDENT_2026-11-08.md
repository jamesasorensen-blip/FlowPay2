# Security incident: credential embedded in legacy source

Status: **OPEN — credential rotation and provider log review not verified.**

## Finding
The previous `server.js` contained a hardcoded Plaid secret, an unauthenticated legacy Plaid API, and broad static serving. The secret may remain in Git history, caches, and clones even after code removal.

## Completed containment
- PR #9 removed the secret from the current application source and disabled the legacy endpoints.
- Node runtime was updated and public file serving restricted.
- Automated regression tests are being added to prevent accidental reintroduction.

## Mandatory operator actions
1. In the Plaid dashboard, rotate/revoke the exposed credential. Never paste the replacement secret into GitHub, chat, screenshots, or support tickets.
2. Update the Cloudflare Worker secret binding (and any other legitimate consumer) using the provider's secure secret manager. Confirm Sandbox Link and transaction synchronization still work.
3. Review Plaid logs and billing/usage for unexpected activity since the credential was committed; investigate anomalies and notify affected parties if warranted.
4. Consider Git history cleanup **only with coordinated planning**: force-pushes can disrupt collaborators, and cleanup does not revoke the credential.
5. Record the credential revocation timestamp, impacted systems, investigation outcome, and verification evidence.

Do not mark this incident closed until all required actions are evidenced.
