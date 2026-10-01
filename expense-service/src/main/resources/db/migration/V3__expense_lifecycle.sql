ALTER TABLE expenses
    ADD COLUMN category VARCHAR(80),
    ADD COLUMN notes VARCHAR(2000),
    ADD COLUMN receipt_name VARCHAR(255),
    ADD COLUMN receipt_content_type VARCHAR(120),
    ADD COLUMN receipt_storage_key VARCHAR(500),
    ADD COLUMN updated_at TIMESTAMPTZ,
    ADD COLUMN deleted_at TIMESTAMPTZ,
    ADD COLUMN revision BIGINT NOT NULL DEFAULT 0;

CREATE TABLE expense_audit (
    id UUID PRIMARY KEY,
    expense_id UUID NOT NULL,
    group_id UUID NOT NULL,
    actor_id UUID NOT NULL,
    action VARCHAR(20) NOT NULL,
    revision BIGINT NOT NULL,
    snapshot TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    UNIQUE (expense_id, revision)
);

CREATE INDEX idx_expense_audit_expense ON expense_audit(expense_id, revision);
