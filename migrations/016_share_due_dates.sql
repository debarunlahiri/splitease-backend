-- A due date for one person's share; when empty the expense's pay-by date applies.
ALTER TABLE expense_shares ADD COLUMN pay_by_date DATE;
