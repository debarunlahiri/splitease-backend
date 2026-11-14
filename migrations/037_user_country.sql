-- The country the person picked in their profile (two-letter code, like IN). It sets their default phone code and currency.
ALTER TABLE users ADD COLUMN country CHAR(2);
