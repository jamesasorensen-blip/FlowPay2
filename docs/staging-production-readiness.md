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
- The staging frontend reports `Cloud unavailable: Failed to fetch`. A preflight using a browser-compatible User-Agent confirms the live Worker rejects `https://flowpay-staging.onrender.com` with HTTP 403 `Origin not allowed`, while the production frontend origin receives HTTP 204. The default command-line User-Agent also receives an unrelated Cloudflare error 1010. A targeted live-origin correction is required; preserve the newer active Worker and its authentication/Sandbox/test-user restrictions.
- The live Worker advertises routes beyond the checked-in staging baseline. Compare the active Worker source/configuration before attempting a banking deployment; do not replace it with an older baseline.
- The prior guest tutorial and widget-options work is separate from authenticated production-readiness acceptance.

## Remaining acceptance gates

1. Diagnose the browser cloud-sync failure; demonstrate authenticated account-scoped save/load and refresh persistence without overwriting divergent local records.
2. Verify live AAL1 financial blocking, AAL2 access, enrollment, sign-out/revocation, account switching, and recovery. Do not change existing authentication or weaken controls merely to get a test passing.
3. Reconcile the redesigned/authenticated app branch with the current staging frontend. Connect balances, bills, transactions, receipts, and next-month bill scheduling to the real account-scoped workflow; standalone examples are not acceptance evidence.
4. Validate Sandbox consent, reconnect, repeated/interrupted sync, deletion/disconnection, deduplication, and ownership boundaries against the deployed Worker/D1 configuration.
5. Finish the requested debt/APR/credit/loan-scenario features with accurate disclosures and the supported receipt-entry/OCR path.
6. Exercise mobile/desktop, cross-browser, PWA, accessibility, and financial regressions on the final integrated staging build.
7. Review retention/deletion/recovery, security/privacy evidence, monitoring, and rollback compatibility.
8. Obtain explicit rollout approval after acceptance evidence is complete. Keep the authenticated production rollout separate from staging preparation.

No production Worker, production database, Supabase configuration, or real bank connection is changed by this checkpoint.
