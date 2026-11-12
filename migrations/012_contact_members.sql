-- People added to a group from the phone's contacts before they have a SplitEase account.
ALTER TABLE users
    ADD COLUMN is_contact BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN contact_email VARCHAR(320),
    ADD COLUMN contact_phone VARCHAR(40),
    ADD COLUMN added_by UUID;
CREATE INDEX idx_users_contact_email ON users(lower(contact_email)) WHERE is_contact;
