BEGIN;
CREATE TABLE IF NOT EXISTS dpa_acceptance (
    id SERIAL PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    version VARCHAR(50) NOT NULL, accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), ip_address VARCHAR(45)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dpa_acceptance_account_version ON dpa_acceptance(account_id, version);
CREATE TABLE IF NOT EXISTS data_deletion_requests (
    id SERIAL PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), scheduled_deletion_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_data_deletion_requests_account ON data_deletion_requests(account_id);
CREATE INDEX IF NOT EXISTS idx_data_deletion_requests_scheduled ON data_deletion_requests(scheduled_deletion_at) WHERE status = 'pending';
COMMIT;
