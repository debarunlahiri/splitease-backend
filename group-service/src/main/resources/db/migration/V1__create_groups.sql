CREATE TABLE expense_groups (
    id UUID PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    default_currency VARCHAR(3) NOT NULL,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE group_members (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    role VARCHAR(20) NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL,
    UNIQUE (group_id, user_id)
);

CREATE INDEX idx_group_members_user ON group_members(user_id);
