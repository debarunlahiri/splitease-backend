-- "I've paid": a person says they paid their share; the payer confirms (or says it hasn't arrived).
CREATE TABLE expense_payment_claims (
    id UUID PRIMARY KEY,
    expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    group_id UUID NOT NULL,
    user_id UUID NOT NULL,
    amount NUMERIC(19, 2) NOT NULL CHECK (amount > 0),
    status VARCHAR(12) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'REJECTED')),
    created_at TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ
);
CREATE INDEX idx_claims_group_pending ON expense_payment_claims(group_id) WHERE status = 'PENDING';
CREATE UNIQUE INDEX uq_claims_one_pending ON expense_payment_claims(expense_id, user_id) WHERE status = 'PENDING';
