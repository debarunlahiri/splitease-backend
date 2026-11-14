-- Whether invoices and receipts can be issued for a group's pay links; the group's creator can turn it off.
ALTER TABLE expense_groups ADD COLUMN invoices_enabled BOOLEAN NOT NULL DEFAULT TRUE;
