-- SplitEase monolith schema.
-- Consolidates the Flyway migrations of the identity, group, expense, settlement,
-- notification and subscription services into one PostgreSQL database.

-- ---------------------------------------------------------------- identity

CREATE TABLE users (
    id UUID PRIMARY KEY,
    email VARCHAR(320) NOT NULL UNIQUE,
    display_name VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    email_verified_at TIMESTAMPTZ,
    firebase_uid VARCHAR(128) UNIQUE,
    photo_url VARCHAR(2048)
);

CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    family_id UUID NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    replaced_by_id UUID
);
CREATE INDEX idx_refresh_tokens_family ON refresh_tokens(family_id);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);

CREATE TABLE email_verification_tokens (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
);
CREATE INDEX idx_email_verification_tokens_user ON email_verification_tokens(user_id);

CREATE TABLE login_throttles (
    subject_hash VARCHAR(64) PRIMARY KEY,
    failed_attempts INTEGER NOT NULL,
    window_started_at TIMESTAMPTZ NOT NULL,
    blocked_until TIMESTAMPTZ
);

-- ------------------------------------------------------------------ groups

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

CREATE TABLE group_invitations (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,
    invitee_user_id UUID,
    invitee_email VARCHAR(320),
    invited_by UUID NOT NULL,
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    responded_at TIMESTAMPTZ,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT ck_group_invitations_status
        CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'REVOKED')),
    CONSTRAINT ck_group_invitation_recipient
        CHECK (invitee_user_id IS NOT NULL OR invitee_email IS NOT NULL)
);
CREATE UNIQUE INDEX uq_group_invitations_pending
    ON group_invitations(group_id, invitee_user_id) WHERE status = 'PENDING';
CREATE UNIQUE INDEX uq_group_invitations_pending_email
    ON group_invitations(group_id, invitee_email) WHERE status = 'PENDING';
CREATE INDEX idx_group_invitations_invitee
    ON group_invitations(invitee_user_id, created_at DESC);
CREATE INDEX idx_group_invitations_email_created
    ON group_invitations(invitee_email, created_at DESC);
CREATE INDEX idx_group_invitations_group
    ON group_invitations(group_id, created_at DESC);

CREATE TABLE group_invite_links (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_group_invite_links_expiry ON group_invite_links(expires_at);

-- ---------------------------------------------------------------- expenses

CREATE TABLE expenses (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL,
    paid_by UUID NOT NULL,
    description VARCHAR(160) NOT NULL,
    amount NUMERIC(19, 2) NOT NULL CHECK (amount > 0),
    currency VARCHAR(3) NOT NULL,
    expense_date DATE NOT NULL,
    split_type VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    category VARCHAR(80),
    notes VARCHAR(2000),
    receipt_name VARCHAR(255),
    receipt_content_type VARCHAR(120),
    receipt_storage_key VARCHAR(500),
    updated_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    revision BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX idx_expenses_group_date ON expenses(group_id, expense_date DESC);

CREATE TABLE expense_shares (
    id UUID PRIMARY KEY,
    expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    amount NUMERIC(19, 2) NOT NULL CHECK (amount >= 0),
    UNIQUE (expense_id, user_id)
);

CREATE TABLE expense_audit (
    id UUID PRIMARY KEY,
    expense_id UUID NOT NULL,
    group_id UUID NOT NULL,
    actor_id UUID NOT NULL,
    action VARCHAR(20) NOT NULL,
    revision BIGINT NOT NULL,
    snapshot TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    UNIQUE (expense_id, revision)
);

-- ------------------------------------------------------------- settlements

CREATE TABLE settlements (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL,
    payer_id UUID NOT NULL,
    payee_id UUID NOT NULL,
    amount NUMERIC(19, 2) NOT NULL CHECK (amount > 0),
    currency VARCHAR(3) NOT NULL,
    note VARCHAR(160),
    created_at TIMESTAMPTZ NOT NULL,
    CHECK (payer_id <> payee_id)
);
CREATE INDEX idx_settlements_group_created ON settlements(group_id, created_at DESC);

-- Per-group, per-user, per-currency balance projection. Positive = is owed money.
CREATE TABLE group_balances (
    id UUID PRIMARY KEY,
    group_id UUID NOT NULL,
    user_id UUID NOT NULL,
    currency VARCHAR(3) NOT NULL,
    amount NUMERIC(19, 2) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (group_id, user_id, currency)
);
CREATE INDEX idx_group_balances_lookup ON group_balances(group_id, currency);

CREATE TABLE expense_projections (
    expense_id UUID PRIMARY KEY,
    group_id UUID NOT NULL,
    revision BIGINT NOT NULL,
    snapshot TEXT
);

-- ----------------------------------------------------------- notifications

CREATE TABLE notifications (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    type VARCHAR(40) NOT NULL,
    title VARCHAR(140) NOT NULL,
    message VARCHAR(500) NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    inbox_visible BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL,
    group_id UUID,
    invitation_id UUID,
    expense_id UUID
);
CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at DESC);

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

CREATE TABLE pending_invitation_alerts (
    event_id UUID PRIMARY KEY,
    email VARCHAR(320) NOT NULL,
    group_id UUID NOT NULL,
    invitation_id UUID NOT NULL,
    group_name VARCHAR(120) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    delivered_to UUID
);
CREATE INDEX idx_pending_alert_email
    ON pending_invitation_alerts(email) WHERE delivered_to IS NULL;

-- ----------------------------------------------------------- subscriptions

CREATE TABLE plans (
    id UUID PRIMARY KEY,
    code VARCHAR(40) NOT NULL UNIQUE,
    name VARCHAR(80) NOT NULL,
    price NUMERIC(19, 2) NOT NULL CHECK (price >= 0),
    currency VARCHAR(3) NOT NULL,
    duration_days INTEGER NOT NULL CHECK (duration_days > 0),
    removes_ads BOOLEAN NOT NULL,
    active BOOLEAN NOT NULL,
    google_product_id VARCHAR(120),
    apple_product_id VARCHAR(120)
);
CREATE UNIQUE INDEX uq_plans_google_product_id
    ON plans(google_product_id) WHERE google_product_id IS NOT NULL;
CREATE UNIQUE INDEX uq_plans_apple_product_id
    ON plans(apple_product_id) WHERE apple_product_id IS NOT NULL;

CREATE TABLE subscriptions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    plan_id UUID NOT NULL REFERENCES plans(id),
    status VARCHAR(20) NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    provider VARCHAR(30) NOT NULL,
    provider_reference VARCHAR(160) NOT NULL UNIQUE
);
CREATE INDEX idx_subscriptions_entitlement ON subscriptions(user_id, status, expires_at DESC);

CREATE TABLE processed_store_notifications (
    notification_id UUID PRIMARY KEY,
    provider VARCHAR(30) NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL
);

INSERT INTO plans (id, code, name, price, currency, duration_days, removes_ads, active,
                   google_product_id, apple_product_id)
VALUES
    ('10000000-0000-0000-0000-000000000001', 'NO_ADS_MONTHLY', 'No Ads Monthly', 49.00, 'INR',
     30, TRUE, TRUE, 'splitease_no_ads_monthly', 'splitease.no_ads.monthly'),
    ('10000000-0000-0000-0000-000000000002', 'NO_ADS_YEARLY', 'No Ads Yearly', 399.00, 'INR',
     365, TRUE, TRUE, 'splitease_no_ads_yearly', 'splitease.no_ads.yearly');

-- ------------------------------------------------------------------ shared

-- One idempotency table for every module (was one per service database).
CREATE TABLE api_idempotency (
    user_id UUID NOT NULL,
    key_hash VARCHAR(64) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    response_json TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ,
    PRIMARY KEY (user_id, key_hash)
);
CREATE INDEX idx_api_idempotency_created ON api_idempotency(created_at);

-- Transactional outbox. Events are written with the business change and delivered
-- to in-process consumers by the dispatcher (this replaces Kafka).
CREATE TABLE outbox_events (
    id UUID PRIMARY KEY,
    aggregate_id UUID NOT NULL,
    event_type VARCHAR(80) NOT NULL,
    topic VARCHAR(120) NOT NULL,
    event_key VARCHAR(160) NOT NULL,
    payload TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ
);
CREATE INDEX idx_outbox_pending ON outbox_events(created_at) WHERE published_at IS NULL;

-- Each consumer records the events it has applied, so redelivery is harmless.
CREATE TABLE processed_events (
    consumer VARCHAR(60) NOT NULL,
    event_id UUID NOT NULL,
    event_type VARCHAR(80) NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (consumer, event_id)
);
