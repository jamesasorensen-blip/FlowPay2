# Isolated recovery-store verification

Run from this directory:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

The pinned, test-only PGlite dependency executes the PostgreSQL draft in an ephemeral in-memory database. There are no Supabase connection strings, cloud requests, real users, factors or sessions. The tests create dummy roles and a dummy owner binding, and explicitly switch session identities to check permissions. Only the fixture administrator backdates records to exercise the waiting period; runtime functions cannot accept arbitrary timestamps.

Checks cover actual SQL compilation, RLS/grants, DB-role-to-owner binding, authoritative record matching, cancellation, stale approval, one-time conditional claims, atomic rollback on audit failure, append-only history and the real JavaScript store adapter. An executor lifecycle uses mocked factor deletion and session verification. PGlite serializes its connection, so overlapping claim tests are not a multi-connection stress test. Its session-reset behavior differs from a persistent Postgres connection; the fixture explicitly sets each identity.

These results do not validate Supabase pooler/login configuration, exposed-schema settings, live owner authentication or live factor reset. The database owner can disable triggers; runtime append-only enforcement is not protection against a compromised database administrator. Production needs separate audit export/monitoring and access review.

The draft remains unapplied. Its operator role is NOLOGIN and no owner binding is inserted by the SQL file. Production configuration must use a dedicated restricted login and separately verified administrative owner authentication. Never use a browser token or caller-supplied principal to populate the binding.
