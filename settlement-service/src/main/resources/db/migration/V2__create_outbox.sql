CREATE TABLE outbox_events (
    id UUID PRIMARY KEY,
    aggregate_id UUID NOT NULL,
    event_type VARCHAR(80) NOT NULL,
    topic VARCHAR(120) NOT NULL,
    event_key VARCHAR(160) NOT NULL,
    payload TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ
);

CREATE INDEX idx_settlement_outbox_pending
    ON outbox_events(created_at)
    WHERE published_at IS NULL;
