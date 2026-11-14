-- Splits that repeat by themselves (rent, maid, internet...). The expense is stored as the request the app
-- would have sent, and a background job creates a fresh copy on each due date.
CREATE TABLE recurring_expenses (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,
    created_by UUID NOT NULL,
    frequency VARCHAR(10) NOT NULL CHECK (frequency IN ('WEEKLY', 'MONTHLY', 'YEARLY')),
    next_run_on DATE NOT NULL,
    -- The day of the month (or year) to keep returning to, so a split set for the 31st is not stuck on the 28th.
    anchor_day SMALLINT NOT NULL,
    ends_on DATE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    template JSONB NOT NULL,
    last_run_on DATE,
    runs INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_recurring_due ON recurring_expenses (next_run_on) WHERE active;
CREATE INDEX ix_recurring_group ON recurring_expenses (group_id);
