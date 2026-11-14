-- When the account holder proved the phone number with a one-time code (Firebase phone sign-in).
ALTER TABLE users ADD COLUMN phone_verified_at TIMESTAMPTZ;
