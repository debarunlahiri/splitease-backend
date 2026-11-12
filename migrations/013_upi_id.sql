-- A person's UPI ID (VPA), so friends can pay them back in INR.
ALTER TABLE users ADD COLUMN upi_id VARCHAR(100);
