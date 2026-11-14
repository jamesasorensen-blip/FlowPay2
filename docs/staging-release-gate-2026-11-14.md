# Staging release gate (2026-11-14)

This document records verified evidence and outstanding checks. Passing unit tests does **not** establish readiness for production.

## Verified in GitHub Actions

- Frontend checks: successful on commit `9bfd2a9e3b78b6b5a20b51de4978423fc5415468` (run 43613875326).
- Application security regression: successful on that commit (run 43613875318).
- PWA install regression: successful on that commit (run 43613875397).
- Frontend routes block private repository files and retire legacy `/api` endpoints; regression coverage added in this PR.

## Must verify against deployed staging before promotion

- [ ] Confirm the deployed Cloudflare Worker revision matches the reviewed source.
- [ ] Confirm the actual `REQUIRE_AAL2` setting; verify that AAL1 financial requests are denied and AAL2 requests succeed. Do not enable the gate before existing users have tested enrollment and recovery.
- [ ] Confirm staging secrets and database bindings are distinct from production, without printing secret values.
- [ ] Exercise MFA enrollment, sign-in, backup authenticator, recovery and account switching on staging.
- [ ] Exercise Plaid Sandbox consent, link, webhook receipt, paginated sync, duplicate delivery, and failed-sync recovery on staging.
- [ ] Verify two separate accounts cannot access one another's connections, transactions, or balances.
- [ ] Check staging logs for errors after these scenarios without copying tokens or personal financial records.
- [ ] Confirm guest workspace cannot call financial APIs and cannot read authenticated data.
- [ ] Verify mobile installation, responsive layout, and browser compatibility against the deployed staging URL.
- [ ] Review dependency lockfile/reproducible install strategy. Current frontend workflow uses `npm install --no-package-lock`.
- [ ] Review and approve the draft PR only after the above gates are complete.

## Release discipline

Keep this PR in draft until checks are complete. Do not merge or deploy to production automatically.
