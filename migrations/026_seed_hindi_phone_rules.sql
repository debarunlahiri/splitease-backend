-- Hindi wording for the per-country phone number check.
INSERT INTO app_strings (key) VALUES
    ('Enter a valid number for {0}, like {1}.'),
    ('Enter a valid number for {0}.')
ON CONFLICT DO NOTHING;

INSERT INTO app_string_translations (key, lang, value) VALUES
    ('Enter a valid number for {0}, like {1}.', 'hi', '{0} के लिए सही नंबर लिखें, जैसे {1}।'),
    ('Enter a valid number for {0}.', 'hi', '{0} के लिए सही नंबर लिखें।')
ON CONFLICT (key, lang) DO NOTHING;
