-- The owner confirmed (in their own UPI app) that the payee name shown for this UPI ID is theirs.
ALTER TABLE users ADD COLUMN upi_verified_at TIMESTAMPTZ;
