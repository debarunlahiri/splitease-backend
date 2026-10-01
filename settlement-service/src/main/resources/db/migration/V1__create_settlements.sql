CREATE TABLE settlements (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL,
    payer_id UUID NOT NULL,
    payee_id UUID NOT NULL,
    amount NUMERIC(19, 2) NOT NULL CHECK (amount > 0),
    currency VARCHAR(3) NOT NULL,
    note VARCHAR(160),
    created_at TIMESTAMPTZ NOT NULL,
    CHECK (payer_id <> payee_id)
);

CREATE INDEX idx_settlements_group_created ON settlements(group_id, created_at DESC);
