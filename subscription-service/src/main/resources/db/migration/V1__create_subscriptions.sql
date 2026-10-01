CREATE TABLE plans (
    id UUID PRIMARY KEY,
    code VARCHAR(40) NOT NULL UNIQUE,
    name VARCHAR(80) NOT NULL,
    price NUMERIC(19, 2) NOT NULL CHECK (price >= 0),
    currency VARCHAR(3) NOT NULL,
    duration_days INTEGER NOT NULL CHECK (duration_days > 0),
    removes_ads BOOLEAN NOT NULL,
    active BOOLEAN NOT NULL
);

CREATE TABLE subscriptions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    plan_id UUID NOT NULL REFERENCES plans(id),
    status VARCHAR(20) NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    provider_reference VARCHAR(160) NOT NULL UNIQUE
);

CREATE INDEX idx_subscriptions_entitlement ON subscriptions(user_id, status, expires_at DESC);

INSERT INTO plans (id, code, name, price, currency, duration_days, removes_ads, active)
VALUES
    ('10000000-0000-0000-0000-000000000001', 'NO_ADS_MONTHLY', 'No Ads Monthly', 49.00, 'INR', 30, TRUE, TRUE),
    ('10000000-0000-0000-0000-000000000002', 'NO_ADS_YEARLY', 'No Ads Yearly', 399.00, 'INR', 365, TRUE, TRUE);
