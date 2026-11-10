-- Published app releases. The newest published row per platform is what the app is told is the
-- latest version (GET /api/v1/app/version).
CREATE TABLE app_versions (
    id UUID PRIMARY KEY,
    platform VARCHAR(20) NOT NULL DEFAULT 'android',
    version_code BIGINT NOT NULL CHECK (version_code > 0),
    version_name VARCHAR(40) NOT NULL DEFAULT '',
    -- Installed versions below this must update before the app can be used.
    min_supported_version_code BIGINT NOT NULL DEFAULT 0,
    apk_url TEXT NOT NULL,
    -- Lowercase hex SHA-256 of the APK; the app refuses a download that does not match.
    apk_sha256 CHAR(64),
    release_notes TEXT NOT NULL DEFAULT '',
    published BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (platform, version_code),
    CONSTRAINT ck_app_versions_url CHECK (apk_url ~* '^https?://'),
    CONSTRAINT ck_app_versions_sha CHECK (apk_sha256 IS NULL OR apk_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_app_versions_min CHECK (min_supported_version_code <= version_code)
);
CREATE INDEX idx_app_versions_latest ON app_versions(platform, version_code DESC) WHERE published;
