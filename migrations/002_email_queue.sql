-- Outgoing email queue. Emails are stored here first and sent by a background worker,
-- which retries failures with a growing delay.
CREATE TABLE email_queue (
    id UUID PRIMARY KEY,
    kind VARCHAR(40) NOT NULL,
    to_address VARCHAR(320) NOT NULL,
    subject VARCHAR(300) NOT NULL,
    -- Bodies are emptied once the email is sent or abandoned (they can hold sign-in codes).
    html TEXT NOT NULL,
    text_body TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    last_error VARCHAR(500)
);
CREATE INDEX idx_email_queue_pending
    ON email_queue(next_attempt_at)
    WHERE sent_at IS NULL AND failed_at IS NULL;
