-- Short, shareable pay links (/p/<code>). The details live here instead of in the URL.
CREATE TABLE pay_links (
    code VARCHAR(16) PRIMARY KEY,
    created_by UUID NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_pay_links_expires ON pay_links(expires_at);
