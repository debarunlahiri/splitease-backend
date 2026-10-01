CREATE TABLE group_balances (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL,
    user_id UUID NOT NULL,
    currency VARCHAR(3) NOT NULL,
    amount NUMERIC(19, 2) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (group_id, user_id, currency)
);

CREATE INDEX idx_group_balances_lookup
    ON group_balances(group_id, currency);

CREATE TABLE processed_events (
    event_id UUID PRIMARY KEY,
    event_type VARCHAR(80) NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL
);
