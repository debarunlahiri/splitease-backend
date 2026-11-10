-- When an invitation email was last sent, used to rate-limit "resend invite".
ALTER TABLE group_invitations ADD COLUMN last_sent_at TIMESTAMPTZ;
UPDATE group_invitations SET last_sent_at = created_at;
