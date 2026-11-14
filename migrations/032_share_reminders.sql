-- Which automatic "please pay" reminders a person has already had for a split, so each is sent only once.
CREATE TABLE share_reminders (
    expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    kind VARCHAR(12) NOT NULL CHECK (kind IN ('DUE_SOON', 'DUE_TODAY', 'LATE_3', 'LATE_7')),
    sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (expense_id, user_id, kind)
);
