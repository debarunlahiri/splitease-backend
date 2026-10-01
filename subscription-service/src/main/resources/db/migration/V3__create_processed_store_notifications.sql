CREATE TABLE processed_store_notifications (
    notification_id UUID PRIMARY KEY,
    provider VARCHAR(30) NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL
);
