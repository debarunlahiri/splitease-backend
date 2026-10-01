ALTER TABLE notifications
    ADD COLUMN inbox_visible BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE notification_preferences (
    user_id UUID PRIMARY KEY,
    inbox_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    push_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    push_token VARCHAR(500)
);

CREATE TABLE push_deliveries (
    id UUID PRIMARY KEY,
    notification_id UUID NOT NULL UNIQUE REFERENCES notifications(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    next_attempt_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    delivered_at TIMESTAMPTZ,
    last_error VARCHAR(500)
);

CREATE INDEX idx_push_deliveries_pending
    ON push_deliveries(next_attempt_at)
    WHERE delivered_at IS NULL AND attempts < 10;
