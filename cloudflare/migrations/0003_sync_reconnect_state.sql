-- Apply once to staging after checking PRAGMA table_info(plaid_sync_jobs).
-- Existing jobs retain their current retry behavior until a login error occurs.
ALTER TABLE plaid_sync_jobs ADD COLUMN last_error_code TEXT;
