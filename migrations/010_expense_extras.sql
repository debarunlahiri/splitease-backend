-- Review-step extras: auto-remind, pay-by date and saved templates (free for everyone for now).
ALTER TABLE expenses
    ADD COLUMN remind_after_days SMALLINT CHECK (remind_after_days IN (2, 3, 7)),
    ADD COLUMN pay_by_date DATE,
    ADD COLUMN reminder_sent_at TIMESTAMPTZ;
CREATE INDEX idx_expenses_reminder_due ON expenses(created_at)
    WHERE remind_after_days IS NOT NULL AND reminder_sent_at IS NULL AND deleted_at IS NULL;

CREATE TABLE expense_templates (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    group_id UUID NOT NULL,
    name VARCHAR(80) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_expense_templates_user_group ON expense_templates(user_id, group_id, created_at DESC);
