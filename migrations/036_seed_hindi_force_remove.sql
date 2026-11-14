-- Hindi wording for removing a person and updating their splits.
INSERT INTO app_strings (key) VALUES
    ('You can take them out of these splits and share their part among everyone else.'),
    ('Remove and update splits'),
    ('Remove and update'),
    ('Not now'),
    ('Remove {0} and update the splits?'),
    ('{0}''s part of each split will be shared among everyone else in it, so the totals stay the same.'),
    ('Everyone affected gets a message, and each split''s history shows the change.'),
    ('{0} paid for some of these splits, so delete those splits first.'),
    ('{0} has already paid part of these splits, so they can''t be taken out automatically.'),
    ('Removed. Their splits were updated and everyone affected was told.')
ON CONFLICT DO NOTHING;

INSERT INTO app_string_translations (key, lang, value) VALUES
    ('You can take them out of these splits and share their part among everyone else.', 'hi', 'आप उन्हें इन स्प्लिट से निकाल सकते हैं और उनका हिस्सा बाक़ी सबमें बाँट सकते हैं।'),
    ('Remove and update splits', 'hi', 'हटाएँ और स्प्लिट अपडेट करें'),
    ('Remove and update', 'hi', 'हटाएँ और अपडेट करें'),
    ('Not now', 'hi', 'अभी नहीं'),
    ('Remove {0} and update the splits?', 'hi', '{0} को हटाएँ और स्प्लिट अपडेट करें?'),
    ('{0}''s part of each split will be shared among everyone else in it, so the totals stay the same.', 'hi', '{0} का हिस्सा हर स्प्लिट में बाक़ी सबमें बाँट दिया जाएगा, इसलिए कुल रकम वही रहेगी।'),
    ('Everyone affected gets a message, and each split''s history shows the change.', 'hi', 'जिन पर असर पड़ेगा, उन सबको संदेश मिलेगा, और हर स्प्लिट के इतिहास में यह बदलाव दिखेगा।'),
    ('{0} paid for some of these splits, so delete those splits first.', 'hi', '{0} ने इनमें से कुछ स्प्लिट चुकाए हैं, इसलिए पहले उन्हें हटाएँ।'),
    ('{0} has already paid part of these splits, so they can''t be taken out automatically.', 'hi', '{0} इन स्प्लिट का कुछ हिस्सा पहले ही चुका चुके हैं, इसलिए उन्हें अपने-आप नहीं निकाला जा सकता।'),
    ('Removed. Their splits were updated and everyone affected was told.', 'hi', 'हटा दिया गया। उनके स्प्लिट अपडेट हो गए और प्रभावित सभी को बता दिया गया।')
ON CONFLICT (key, lang) DO NOTHING;
