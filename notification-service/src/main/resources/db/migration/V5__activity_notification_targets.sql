ALTER TABLE notifications ADD COLUMN group_id UUID;
ALTER TABLE notifications ADD COLUMN invitation_id UUID;
ALTER TABLE notifications ADD COLUMN expense_id UUID;
CREATE TABLE pending_invitation_alerts (
    event_id UUID PRIMARY KEY,
    email VARCHAR(320) NOT NULL,
    group_id UUID NOT NULL,
    invitation_id UUID NOT NULL,
    group_name VARCHAR(120) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    delivered_to UUID
);
CREATE INDEX idx_pending_alert_email ON pending_invitation_alerts(email) WHERE delivered_to IS NULL;
