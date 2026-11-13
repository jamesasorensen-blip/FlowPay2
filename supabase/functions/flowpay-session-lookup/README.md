# Supabase Edge Function snapshot

This source file was copied from the **active version 3** `flowpay-session-lookup` Edge Function during a read-only inspection on 2026-11-12. The original source comment saying "NOT DEPLOYED" is retained verbatim for traceability, but is stale: the remote function is ACTIVE.

This is a **source snapshot**, not an approved production release or deployment instruction. It uses server-side `SUPABASE_DB_URL`, `FLOWPAY_SESSION_LOOKUP_SECRET`, and `FLOWPAY_STAGING_TEST_USER_ID`; no values are stored here. The Supabase project is shared with production. Do not deploy or broaden the allowlist without separate review.

The repository's Worker adapter sends a dedicated bearer secret. The deployed Edge Function has `verify_jwt=false` and checks that secret itself. Confirm runtime secret presence, network access, and test-account isolation before enabling any enforcement flags.

The snapshot was obtained from the Supabase function API; it is not evidence that live session lookup tests have passed.
