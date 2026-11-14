-- Hindi wording for the friend details sheet.
INSERT INTO app_strings (key) VALUES
    ('All settled'),
    ('Couldn’t load this friend.'),
    ('Splits together'),
    ('You are not in any Split together yet.'),
    ('Splits between you'),
    ('No splits between you yet.'),
    ('Settled')
ON CONFLICT DO NOTHING;

INSERT INTO app_string_translations (key, lang, value) VALUES
    ('All settled', 'hi', 'सब हिसाब बराबर'),
    ('Couldn’t load this friend.', 'hi', 'इस दोस्त की जानकारी नहीं खुल सकी।'),
    ('Splits together', 'hi', 'साथ के स्प्लिट'),
    ('You are not in any Split together yet.', 'hi', 'आप अभी किसी स्प्लिट में साथ नहीं हैं।'),
    ('Splits between you', 'hi', 'आप दोनों के बीच के स्प्लिट'),
    ('No splits between you yet.', 'hi', 'अभी आप दोनों के बीच कोई स्प्लिट नहीं है।'),
    ('Settled', 'hi', 'चुकता')
ON CONFLICT DO NOTHING;
