CREATE TABLE expense_attachments (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,
    uploader_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expense_id UUID REFERENCES expenses(id) ON DELETE CASCADE,
    position SMALLINT CHECK (position BETWEEN 0 AND 4),
    name VARCHAR(255) NOT NULL,
    content_type VARCHAR(120) NOT NULL,
    data BYTEA NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 10485760),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((expense_id IS NULL) = (position IS NULL))
);

CREATE INDEX idx_expense_attachments_expense ON expense_attachments(expense_id, position);
CREATE INDEX idx_expense_attachments_staged ON expense_attachments(created_at) WHERE expense_id IS NULL;
CREATE INDEX idx_expense_attachments_staged_uploader ON expense_attachments(uploader_id) WHERE expense_id IS NULL;
