CREATE TABLE ios_update_subscriptions (
    email VARCHAR(320) PRIMARY KEY,
    token_hash CHAR(64) NOT NULL UNIQUE,
    requested_at TIMESTAMPTZ NOT NULL,
    confirmed_at TIMESTAMPTZ
);
CREATE INDEX idx_ios_update_subscriptions_requested ON ios_update_subscriptions(requested_at);
