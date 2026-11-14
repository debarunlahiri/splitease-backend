-- Small on/off switches the admin panel can change without a release.
CREATE TABLE app_settings (
    key VARCHAR(80) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Everyone must confirm their phone number with an SMS code, unless an admin turns this off.
INSERT INTO app_settings (key, value) VALUES ('phone_verification_required', 'true');

-- One person can be made an exception either way; empty means "follow the global switch".
ALTER TABLE users ADD COLUMN phone_verification VARCHAR(12)
    CHECK (phone_verification IN ('REQUIRED', 'NOT_REQUIRED'));
