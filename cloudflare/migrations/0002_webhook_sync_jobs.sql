-- Apply to staging after 0001 and before promoting the automatic-sync Worker.
CREATE TABLE IF NOT EXISTS plaid_sync_jobs (
    connection_id TEXT PRIMARY KEY NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
    generation INTEGER NOT NULL DEFAULT 0,
    processed_generation INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    lease_token TEXT NOT NULL DEFAULT '',
    lease_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS plaid_sync_jobs_due ON plaid_sync_jobs(next_attempt_at);
-- The CHECK turns a lost lease, changed cursor or withdrawn consent into a
-- batch failure before any financial changes commit. The row carries no user data.
CREATE TABLE IF NOT EXISTS plaid_sync_commit_fence (
    id INTEGER PRIMARY KEY CHECK (id = 1)
);
