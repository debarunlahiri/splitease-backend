-- Account suspension (set by an admin; blocks sign-in and token refresh).
ALTER TABLE users ADD COLUMN disabled_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN disabled_reason VARCHAR(300);

-- Everything an administrator changes is recorded here.
CREATE TABLE admin_audit (
    id UUID PRIMARY KEY,
    admin_id UUID,
    admin_email VARCHAR(320) NOT NULL,
    action VARCHAR(60) NOT NULL,
    target_type VARCHAR(40),
    target_id VARCHAR(80),
    detail TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_admin_audit_created ON admin_audit(created_at DESC);
