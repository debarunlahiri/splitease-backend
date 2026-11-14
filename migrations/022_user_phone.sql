-- The account holder's own phone number, always with its country code (E.164, e.g. +919876543210).
ALTER TABLE users ADD COLUMN phone VARCHAR(20);
