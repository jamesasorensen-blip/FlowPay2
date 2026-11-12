# Staging production-readiness checkpoint

Updated November 12, 2026. This is a status record, not production-rollout approval.

## Completed in this checkpoint

- Bind each cloud/bank request to the user and account generation that initiated it. Refuse a mismatched Supabase session before using its token.
- Cancel old requests when switching away and back, discard late responses, and prevent an old cloud save from releasing a new account's save lock.
- Carry the generation through consent checks and Plaid Link creation/callbacks, bank refresh/sync cleanup, and MFA cloud-read retries.
- Run 15 executable account-switch regressions plus 79 existing staging/MFA/session/loading/backup regressions offline. These use synthetic sessions, tokens, and network stubs; they do not replace live multi-account testing.
- Add the account-switch suite to staging CI.

## Verified observations

- Browser navigation to the staging API root reports online and Sandbox mode.
- Diagnosed the failed cloud connection: the live Worker rejected the staging website origin. Read the active source from Cloudflare and verified it exactly matches commit `92997b4e702244683ead9ea86dc70f58f51fa8be` after newline normalization. Applied only a three-line allowlist/reflection change, preserving OAuth defaults, Sandbox/test-user restrictions, and all newer bank/webhook/sync code. Cloudflare reports new active version `34de5b3d`. The exact patched source is retained in `cloudflare/candidates/staging-worker-origin-fix.mjs`. Eight isolated CORS/authentication/Sandbox regression tests pass. Live preflights now return 204 with the exact allowed origin for both FlowPay frontends; an untrusted origin receives 403 without an allow-origin header, and an anonymous financial read receives 401. Browser reload reports bank connections ready and no cloud financial data for the current staging test account; no data was imported, replaced, or deleted.
- The live Worker has newer webhook/sync routes but does not yet contain the AAL2/session-enforcement implementation in the staging branch. Reconcile these versions before any further backend rollout; do not replace the newer live banking code with the older baseline.
- The prior guest tutorial and widget-options work is separate from authenticated production-readiness acceptance.

## Remaining acceptance gates

1. Authenticated account-scoped import/save/load and refresh persistence passed for the current staging account (see live evidence below). Multi-account and divergent-record acceptance remains required.
2. Verify live AAL1 financial blocking, AAL2 access, enrollment, sign-out/revocation, account switching, and recovery. Do not change existing authentication or weaken controls merely to get a test passing.
3. Reconcile the redesigned/authenticated app branch with the current staging frontend. Connect balances, bills, transactions, receipts, and next-month bill scheduling to the real account-scoped workflow; standalone examples are not acceptance evidence.
4. Validate Sandbox consent, reconnect, repeated/interrupted sync, deletion/disconnection, deduplication, and ownership boundaries against the deployed Worker/D1 configuration.
5. Finish the requested debt/APR/credit/loan-scenario features with accurate disclosures and the supported receipt-entry/OCR path.
6. Exercise mobile/desktop, cross-browser, PWA, accessibility, and financial regressions on the final integrated staging build.
7. Review retention/deletion/recovery, security/privacy evidence, monitoring, and rollback compatibility.
8. Obtain explicit rollout approval after acceptance evidence is complete. Keep the authenticated production rollout separate from staging preparation.

No production Worker, production database, Supabase configuration, or real bank connection is changed by this checkpoint.


## Authenticator reporting follow-up

The user completed authenticator verification in the staging UI. The active API's
`/me` response omitted `user.aal`, which the frontend requires before retrying its
cloud read. The candidate now returns only the assurance level from the already
signature-verified JWT, normalizing missing/unknown values to `aal1`. Five signed-
JWT regressions cover AAL1, AAL2, missing/unknown claims, and a tampered elevation.
This is metadata reporting, not a change to MFA enforcement, credentials, bindings,
or data. Live verification and cloud persistence testing follow deployment.


## Safe empty-account initialization

Clone nested default settings/arrays before normalizing account data. Start Fresh
now constructs zero monetary balances/allowances/goals and empty financial lists;
it no longer treats a cached nonzero starting balance as disposable demo data.
Three regressions verify zero initialization, nested default isolation, and the
nonzero-balance preservation guard. The staging session metadata fix is live as
Worker version `4b8ce03b`; the verified session reaches the no-cloud-data state.


## Account-scoped import path

The existing import button reads the legacy global budget key. The user chose to
back up and import the existing account-scoped browser budget into staging.
A separate button now reads only the active account cache, confirms the action,
rechecks cloud absence/test-record status and revision, checks for concurrent
browser changes, downloads a backup, and performs a revision-protected write.
Account changes and new cloud records abort the import. Newer browser edits made
while a write is pending are preserved and synchronization remains paused for
reconciliation. Production data and the unrelated legacy budget are untouched.

## Live cloud persistence evidence — November 12, 2026

Staging frontend merge `d69e6e6bb5de98433cbbd4ccc2edb813710e0e7b` is deployed.
After the user accepted the backup/import confirmation, the UI reported
“Account browser budget imported. Cloud synced.” The backup download itself was
not independently inspected. Changed the savings goal from $200 to $12.34,
observed “Cloud synced”, reloaded, and verified $12.34/mo with a $500 balance.
Restored $200, observed synchronization, reloaded again, and verified $200/mo,
$500 balance, and “Cloud synced”. No bill or paycheck was added or deleted.
The 117 targeted regressions passed before deployment. This verifies one signed-in
staging account; it does not establish multi-account isolation or live AAL1 blocking.
The dashboard also still displays an obsolete local-only financial-data notice;
its wording must be reconciled with the account-scoped cloud implementation.
Production remained unchanged.
