# FlowPay staging management

The Worker source here is the complete consent/audit update tested manually in
the staging Worker on November 8, 2026. It is a baseline for review, not a claim
that repository contents have been compared byte-for-byte with the live Worker.
Production frontend files and its Node server are not changed.

## First connection check

1. In repository Settings > Environments, configure `cloudflare-staging`.
2. Add the environment secret `CLOUDFLARE_API_TOKEN` there (not a repository secret).
3. Set yourself as a required reviewer. Leave prevent self-review off when you
   need to approve your own manually dispatched run. If reviewers are unavailable,
   do not treat this as a protected deployment setup.
4. Restrict environment deployments to the `main` branch.
5. Review and merge this PR only after approval. No workflow runs on push or PR.
6. Manually run `Cloudflare staging connection check` on `main`, approve the
   environment job, and review its sanitized output.

The workflow only GETs the staging Worker's settings. It does not deploy, query
D1 rows, rotate credentials, or access production. It validates the known staging
D1 ID, Sandbox setting, secret binding types and presence of the test-user gate.
It never prints binding values, raw API responses, source code, or tokens.

## Scope and limits

The token created in the dashboard has account-wide Workers Scripts Edit access;
the token itself is not staging-only. This checker hardcodes staging and does not
accept arbitrary account names, Worker names, API paths or commands. Treat write
access to workflows/scripts as security-sensitive because the credential is broad.
The token expires December 8, 2026 and must be renewed or revoked deliberately.

## Approved staging version management

`Manage Cloudflare staging version` is manually dispatched on main only, with
the same protected environment. It has three separate operations:

- `inspect` (default): reads the active version ID and sanitized configuration.
- `upload`: uploads the checked-in Worker as a version without routing traffic
  to it. Requires the exact main commit SHA and current active version UUID.
- `promote`: routes 100% of staging traffic to an explicitly selected previously
  uploaded version annotated with that reviewed commit. Requires another run
  and environment approval. It refuses different bindings or runtime metadata.
  A candidate from an ancestor commit is accepted only if its Worker source is
  byte-for-byte identical to the currently approved Worker source.

Every run requires the full reviewed main commit SHA and the confirmation text
`flowpay-plaid-api-staging`. Upload and promote need the full active version UUID
from inspect. Promote additionally needs the full uploaded candidate UUID.
Workflow input values are passed through environment variables, not shell code.

No push or PR event can invoke either workflow. Required reviewers and main-only
environment deployment branches must remain enabled in GitHub Settings. The
workflow cannot enforce account-wide security against a repository administrator
who changes its code or environment rules.

Upload uses the Workers Versions API `keep_bindings` for plain-text, encrypted
secret and D1 bindings, preserving their existing values. It refuses pending
undeployed versions and additional binding types, and verifies the uploaded
binding metadata before any promotion. It retains compatibility date/flags and
usage model where returned. Additional runtime limits, placement, cache settings
or exports cause a stop for review. Raw responses and binding values stay private.

Cloudflare mutation requests are not automatically retried. A failed/timeout run
can leave an undeployed version or an unknown promotion result: inspect before
retrying. Version/deployment checks reduce accidental concurrent changes, but
the API offers no atomic compare-and-swap here; avoid dashboard edits while a
run is in progress. Secret values are opaque, so metadata comparisons cannot
prove two versions contain identical secret values. Do not rotate secrets
between upload and promotion.

Upload and promotion both succeeded in approved live staging runs on November 8,
2026. The promotion response confirmed the selected version at 100% traffic. No Worker code, bindings, D1 data or production resource
is changed by merging the workflow files themselves. The repository also has
GitHub Pages builds triggered by merges; confirm hosting impact before merging.
Obtain explicit approval before running upload/promotion or data-mutation work.
Do not place credentials in this repository or overwrite live settings with an
incomplete Wrangler config. No schema migrations or destructive D1 actions are
included in this workflow.

Remaining Worker concerns include live cross-user isolation testing, audit retention,
rate limiting and live last-bank disconnection testing. Some connection and refresh
paths still need a review of audit atomicity. Transaction synchronization now
batches transaction changes, cursor advancement, and its audit entry atomically
in the checked-in staging source; this does not prove that source is deployed.

## Local validation

```sh
node --check cloudflare/staging-worker.mjs
python3 -m unittest discover -s cloudflare/tests -v
```

## Local account isolation regression tests

With Node.js 24, run:

```sh
node --test cloudflare/tests/account-isolation.test.mjs
```

These tests execute the unmodified staging Worker using locally generated ES256
JWTs and an in-memory SQLite D1 adapter. The local JWKS endpoint and
explicitly stubbed Plaid sandbox calls are permitted; other outbound requests
are blocked. No cloud credentials or real user records are used.
They cover the staging allowlist, per-user cloud/account/transaction/consent
reads, forged user IDs, foreign-connection sync and disconnect rejection,
cloud-data writes, and consent withdrawal scope. To reach ownership checks for
each synthetic identity, the test fixture changes its local allowlisted user;
no deployed restriction is changed.

Passing these tests does not establish live two-account isolation, frontend
browser-storage isolation, production behavior, or full deletion/connection
lifecycle isolation. The SQLite adapter models only the D1 operations exercised here. Its D1 batch
simulator uses a SQLite transaction with rollback on failure, but it cannot
establish parity with Cloudflare D1's remote execution semantics.

## CI verification and staging deployment status (November 10, 2026)

GitHub pull request #18 passed the Worker isolation and synchronization contract
suites, application security regression checks, frontend tests and Docker build.
It was merged as commit `581a487615435310ad24eb1c52008fea8feaddb4`.
Render reported that commit live for the frontend. This does **not** deploy the
Cloudflare Worker. Worker code after the November 8 staging promotion remains
unverified against the deployed script until an approved inspect/upload/promote
sequence and staging smoke tests are completed.

Before any staging promotion, capture the current active Worker version using the
protected inspect workflow, review the source changes and bindings, upload an
unrouted candidate, then separately approve promotion. Test a sandbox-only bank
connection and sync against the actual staging Worker after promotion. Never
assume that passing local SQLite tests proves the remote D1 schema or secrets.

The local integration suite additionally exercises consent withdrawal before
transaction sync and balance refresh. Both paths must reject before calling Plaid
and must not change the stored financial records. These are synthetic fixtures,
not a substitute for protected staging checks.

The staging source also validates Plaid account IDs before balance refresh:
invalid/duplicate IDs and IDs already owned by a different connection are
rejected before account updates. The synthetic integration test verifies that
a foreign account balance and audit history remain unchanged.

A further synthetic regression test ensures that duplicate Plaid account IDs are
rejected before any balance update or refresh audit entry is written.

The staging Worker root health endpoint also fails closed when PLAID_ENV is
not sandbox, and its regression is included in the worker isolation CI suite.

The balance refresh ownership and duplicate-ID regressions now mock Plaid's
`/accounts/get` endpoint explicitly and assert the specific rejection reason,
so a blocked outbound request cannot produce a false-positive test pass.

## Plaid OAuth and webhook staging preparation

The checked-in staging Worker accepts optional environment bindings:
`PLAID_OAUTH_REDIRECT_URI` (the HTTPS frontend OAuth return page, registered in
Plaid Dashboard) and `PLAID_WEBHOOK_URL` (the HTTPS URL of the Worker
`/plaid-webhook` route). Leave both unset until their corresponding routes and
dashboard settings have been reviewed. These are not secret values.

The `/plaid-webhook` route is public to Plaid but fails closed without a valid
`Plaid-Verification` ES256 JWT, fresh issuance time, matching Plaid JWK and
raw-body SHA-256. It currently only acknowledges valid events; it does not
update financial data, queue transaction sync or store webhook history.
In particular, receiving `NEW_ACCOUNTS_AVAILABLE` does not automatically
add accounts. Replay deduplication, persistence, item ownership checks and
background sync must be implemented before event-driven financial writes.

The frontend OAuth return logic is implemented and covered by static regression
checks, but has NOT yet passed a live browser/Sandbox OAuth redirect test. Do not
set `PLAID_OAUTH_REDIRECT_URI` until the exact URL is registered in Plaid Dashboard
and a protected staging deployment and end-to-end test are planned. The webhook
URL is also not registered on existing Plaid Items by a source-code change;
existing Items may require `/item/webhook/update` once staging is approved.
The protected Cloudflare staging upload/promotion workflow remains mandatory.

The initial webhook route has synthetic negative-path tests for unsigned,
malformed, and non-sandbox requests. A signed Plaid sandbox delivery test
is still required before considering the integration end-to-end verified.

The synthetic webhook suite now also signs a NEW_ACCOUNTS_AVAILABLE event
using a generated ES256 key, mocks Plaid key retrieval, and checks that an
altered request body is rejected. It does not substitute for sandbox delivery.

Webhook synthetic regression checks also reject an altered ES256 signature,
not just a modified event body.

The frontend now preserves the Link token in user-scoped sessionStorage and
passes the returning OAuth URL as receivedRedirectUri. This remains unverified
against a real Sandbox OAuth institution until staging is deployed and Plaid
Dashboard has the exact HTTPS frontend redirect URL registered.

## Next protected staging checklist

1. Confirm that the frontend deployed at `https://flowpay-6aay.onrender.com/`
   includes the OAuth return changes and that a browser can reopen the app.
2. In Plaid Dashboard register the **exact** HTTPS redirect URI
   `https://flowpay-6aay.onrender.com/` (including trailing slash). This
   is a browser/PWA redirect; no Android SDK package name is required.
3. In the staging Worker's Cloudflare settings, set the plain-text binding
   `PLAID_OAUTH_REDIRECT_URI=https://flowpay-6aay.onrender.com/` only after
   confirming the dashboard entry. Set `PLAID_WEBHOOK_URL` to the staging
   Worker's own exact HTTPS URL followed by `/plaid-webhook`. Never place
   credentials in either URL. Confirm the live Worker route hostname first.
4. Inspect the staging Worker version and binding metadata through the protected
   GitHub Action; review the currently checked-in source and full main SHA.
   Upload an unrouted version, then separately approve promotion. Do not bypass
   the required GitHub environment review.
5. After promotion, create a fresh Plaid Sandbox Item, perform a real OAuth
   round trip, and call Plaid's `/sandbox/item/fire_webhook` with webhook
   code `NEW_ACCOUNTS_AVAILABLE`. Confirm Plaid's delivery and the Worker
   response. Existing Items do not inherit the new webhook URL automatically.

No production Plaid rollout, account migration, or background financial writes
are authorized by these staging steps.

The OAuth callback path resumes Plaid Link independently of bank account list
retrieval. This prevents a transient listing error from blocking OAuth return.

The Worker validates optional Plaid Link URL bindings before token creation:
OAuth redirect must be the exact HTTPS frontend root, and webhook must be
this Worker's own HTTPS origin at /plaid-webhook. Other hosts, paths, queries,
credentials and fragments are rejected before contacting Plaid.

Signed webhook events must also have a valid bounded event envelope. The
validator accepts future uppercase Plaid event codes to avoid unnecessary
retries when Plaid introduces a new code. Valid events are acknowledged only;
no account data is changed, and a durable replay ledger/queue is not installed.

After Plaid Link succeeds or exits, the browser removes oauth_state_id from
the current URL using replaceState. The token remains tab-scoped and is removed
on completion, avoiding a stale callback prompt after refreshing the page.

### Staging Item webhook diagnostic

The authenticated POST /diagnostics/item-webhook endpoint accepts JSON
`{"connection_id":"<UUID from bank-accounts>"}` from the FlowPay frontend origin,
restricted to the configured staging test user and active bank consent. It calls
Plaid /item/get read-only and returns only webhook_configured,
webhook_matches_staging, and expected_webhook_configured booleans. It does not
return Plaid credentials, Item IDs, or the configured webhook URL, and never
modifies bank data. It is staging-only; do not copy it into production.


## Durable staging webhook delivery receipts

Apply `cloudflare/migrations/0001_webhook_receipts.sql` to the verified staging
D1 database before promoting the receipt-aware Worker. The migration creates
an empty receipt table and timestamp index and can be reapplied.

Verified deliveries for exactly one Item owned by the configured staging test
user, with active bank consent, now record a receipt before acknowledgement.
Repeated verification tokens share one receipt through a database uniqueness
constraint. New tokens with identical bodies remain distinct deliveries.
Receipts store only the verification token SHA-256 fingerprint, event type,
event code and receipt time. Storage errors return HTTP 503 so Plaid can retry.
Unknown, ambiguous, foreign and withdrawn-consent Items receive an acknowledgement
without a receipt. No payload or token is logged or stored.

Receipts older than seven days are pruned on the next eligible delivery. During
idle periods they remain until that delivery. Token freshness verification rejects
replay after five minutes. A receipt establishes delivery, and automatic transaction
sync, its durable job lifecycle and retry monitoring remain to be implemented.
Earlier acknowledgement-only descriptions above describe the previous source.
This migration and Worker update require staging deployment and a live delivery
check before they can be described as active.

## Automatic transaction sync and retries

The updated Worker queues `TRANSACTIONS / SYNC_UPDATES_AVAILABLE` deliveries in
an atomic receipt-and-job batch. It coalesces pending work by connection while
preserving events that arrive during a sync. Manual refresh and background work
share a five-minute database lease and the existing transaction validation engine.
An in-transaction CHECK fence prevents a stale lease, changed starting cursor,
removed connection or withdrawn consent from committing financial changes.

Failures retain pending work with exponential backoff starting at 30 seconds,
capped at one hour. Logs contain fixed operational messages. Authenticated
`GET /diagnostics/sync-status?connection_id=<owned UUID>` returns pending/running
flags, attempt count, next retry time (Unix seconds), and last sync time.
Account availability notifications record delivery but do not import new accounts.

Deployment order for staging:

1. Apply migration `0001_webhook_receipts.sql`, then `0002_webhook_sync_jobs.sql`
   to the verified staging D1 database. Both migrations can be reapplied.
2. Use the existing protected staging inspect/upload/promote workflow for the
   reviewed commit, preserving current bindings and the test-user restriction.
3. Configure a Cron Trigger on the staging Worker with expression `* * * * *`.
   The scheduled handler processes at most five due connections per invocation.
   Webhook requests also attempt immediate processing through `waitUntil`.
   Durable retries after idle periods depend on this Cron Trigger.
4. Send a fresh Sandbox `SYNC_UPDATES_AVAILABLE` test webhook. Confirm HTTP 200,
   then authenticated job status, cursor advancement and a sync audit entry.
5. Check the next scheduled invocation and a synthetic retry before treating
   background operation as live-verified.

The job schema stores connection IDs and operational counters only. Jobs are
removed in the existing financial-data deletion and bank-disconnection batches.
The commit-fence table has one constant row with no user data. Local regression
tests cover signed receipts, atomic enqueue rollback, successful background sync,
retry scheduling, simultaneous manual refresh, events arriving during sync,
stale leases and consent withdrawal during a Plaid request. Live D1 execution,
Cron configuration and a Sandbox delivery still require deployment verification.

Cloudflare scheduled-handler reference:
https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/

## Staging bank sign-in recovery

Apply `0003_sync_reconnect_state.sql` once after verifying that
`PRAGMA table_info(plaid_sync_jobs)` has no `last_error_code` column. Apply the
migration before promoting this Worker. Existing rows start with a null error
code and retain their normal retry behavior.

A Plaid `ITEM_LOGIN_REQUIRED` sync failure or a verified owned `ITEM / ERROR`
webhook records a fixed login-required state. Scheduled and manual sync pause
until reconnection. The authenticated sync diagnostic exposes only a
`requires_reconnect` boolean in addition to its existing operational fields.
`ITEM / LOGIN_REPAIRED` deliveries can also release pending work when the bank
repairs a connection outside FlowPay. Delivery fingerprints prevent replayed
notifications from enqueueing the same work twice.

In the isolated staging bank panel, Reconnect bank requests `/link-token` with
the existing connection ID. The Worker validates ownership and active consent,
then creates a Plaid update-mode token using the encrypted stored access token.
The browser receives only the Link token. Update mode omits `products` and
uses the existing Item. Its success callback calls `/reconnect-complete` and
does not exchange a public token or create a bank connection.

Completion checks `/item/get` for the matching Item with `error: null` before
atomically releasing the paused job and writing its audit entry. Repeating
completion is idempotent. Consent and ownership are checked again at the write
boundary. Releasing a paused job invalidates its old lease, so an older sync
response cannot overwrite recovery state or commit stale financial data.

User-scoped, tab-scoped OAuth context retains the connection ID and restores
the staging environment before consent/account requests. Expired, ambiguous,
malformed and foreign-user contexts fail closed. Older new-connection sessions
remain supported. Starting a new Link flow replaces only that user's pending
Link sessions.

Plaid references used for the update-mode and Item-state contract:
https://plaid.com/docs/link/update-mode/
https://plaid.com/docs/api/items/
