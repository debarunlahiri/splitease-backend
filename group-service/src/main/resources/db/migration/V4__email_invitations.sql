ALTER TABLE group_invitations ALTER COLUMN invitee_user_id DROP NOT NULL;
ALTER TABLE group_invitations ADD COLUMN invitee_email VARCHAR(320);
ALTER TABLE group_invitations ADD CONSTRAINT ck_group_invitation_recipient
    CHECK (invitee_user_id IS NOT NULL OR invitee_email IS NOT NULL);
CREATE UNIQUE INDEX uq_group_invitations_pending_email
    ON group_invitations(group_id, invitee_email) WHERE status = 'PENDING';
CREATE INDEX idx_group_invitations_email_created
    ON group_invitations(invitee_email, created_at DESC);
