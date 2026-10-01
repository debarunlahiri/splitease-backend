CREATE TABLE group_invitations (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,
    invitee_user_id UUID NOT NULL,
    invited_by UUID NOT NULL,
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    responded_at TIMESTAMPTZ,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT ck_group_invitations_status
        CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'REVOKED'))
);

CREATE UNIQUE INDEX uq_group_invitations_pending
    ON group_invitations(group_id, invitee_user_id)
    WHERE status = 'PENDING';

CREATE INDEX idx_group_invitations_invitee
    ON group_invitations(invitee_user_id, created_at DESC);

CREATE INDEX idx_group_invitations_group
    ON group_invitations(group_id, created_at DESC);
