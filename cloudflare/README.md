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

A separate reviewed deployment workflow is still needed. No deployment command
is included in this initial connection check. Obtain explicit approval before
adding/running deployment or data-mutation operations. Do not place credentials
in this repository or overwrite live settings with an incomplete Wrangler config.

Remaining Worker concerns include cross-user isolation testing, audit retention,
rate limiting and live last-bank disconnection testing. Audit writes for connect,
refresh and sync currently occur after their data changes, so they are not atomic.

## Local validation

```sh
node --check cloudflare/staging-worker.mjs
python3 -m unittest discover -s cloudflare/tests -v
```
