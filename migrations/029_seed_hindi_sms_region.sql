-- Hindi wording for the 'SMS not available for this country' message.
INSERT INTO app_strings (key) VALUES
    ('Codes can''t be sent to this country yet. Please try again later.')
ON CONFLICT DO NOTHING;

INSERT INTO app_string_translations (key, lang, value) VALUES
    ('Codes can''t be sent to this country yet. Please try again later.', 'hi', 'इस देश में अभी कोड नहीं भेजे जा सकते। कृपया बाद में फिर कोशिश करें।')
ON CONFLICT (key, lang) DO NOTHING;
