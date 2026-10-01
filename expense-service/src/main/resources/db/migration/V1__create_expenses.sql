CREATE TABLE expenses (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL,
    paid_by UUID NOT NULL,
    description VARCHAR(160) NOT NULL,
    amount NUMERIC(19, 2) NOT NULL CHECK (amount > 0),
    currency VARCHAR(3) NOT NULL,
    expense_date DATE NOT NULL,
    split_type VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE expense_shares (
    id UUID PRIMARY KEY,
    expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    amount NUMERIC(19, 2) NOT NULL CHECK (amount >= 0),
    UNIQUE (expense_id, user_id)
);

CREATE INDEX idx_expenses_group_date ON expenses(group_id, expense_date DESC);
