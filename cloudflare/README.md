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
rate limiting and live last-bank disconnection testing. Audit writes for connect,
refresh and sync currently occur after their data changes, so they are not atomic.

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
JWTs and an in-memory SQLite D1 adapter. All outbound requests except the local
JWKS stub are blocked. No cloud credentials or real user records are used.
They cover the staging allowlist, per-user cloud/account/transaction/consent
reads, forged user IDs, foreign-connection sync and disconnect rejection,
cloud-data writes, and consent withdrawal scope. To reach ownership checks for
each synthetic identity, the test fixture changes its local allowlisted user;
no deployed restriction is changed.

Passing these tests does not establish live two-account isolation, frontend
browser-storage isolation, production behavior, or full deletion/connection
lifecycle isolation. The SQLite adapter models only the D1 operations exercised
here and does not simulate D1 transaction rollback.
