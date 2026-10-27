CREATE TABLE group_invite_links (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_group_invite_links_expiry ON group_invite_links(expires_at);
