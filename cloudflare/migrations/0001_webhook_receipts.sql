-- Apply to the staging D1 database before promoting the receipt-aware Worker.
-- Receipts describe delivery only. They do not establish transaction sync success.
CREATE TABLE IF NOT EXISTS plaid_webhook_receipts (
    id TEXT PRIMARY KEY NOT NULL,
    webhook_type TEXT NOT NULL,
    webhook_code TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS plaid_webhook_receipts_received_at
    ON plaid_webhook_receipts (received_at);
