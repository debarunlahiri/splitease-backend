CREATE TABLE processed_events (
    event_id UUID PRIMARY KEY,
    event_type VARCHAR(80) NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL
);
