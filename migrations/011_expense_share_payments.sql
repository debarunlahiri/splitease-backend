-- How much of each person's share has already been paid back to the payer.
ALTER TABLE expense_shares
    ADD COLUMN paid_amount NUMERIC(19, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0);
