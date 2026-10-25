CREATE TABLE api_idempotency (
    user_id UUID NOT NULL,
    key_hash VARCHAR(64) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    response_json TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ,
    PRIMARY KEY (user_id, key_hash)
);

CREATE INDEX idx_api_idempotency_created ON api_idempotency(created_at);
