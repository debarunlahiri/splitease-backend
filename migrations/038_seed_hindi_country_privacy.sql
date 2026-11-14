-- Hindi wording for the country setting and the privacy policy.
INSERT INTO app_strings (key) VALUES
    ('Country'),
    ('{0} · used for phone numbers and currency'),
    ('Privacy policy'),
    ('By continuing you agree to our Privacy policy'),
    ('We couldn''t open the privacy policy. Check your internet and try again.'),
    ('Open in browser')
ON CONFLICT DO NOTHING;

INSERT INTO app_string_translations (key, lang, value) VALUES
    ('Country', 'hi', 'देश'),
    ('{0} · used for phone numbers and currency', 'hi', '{0} · फ़ोन नंबर और मुद्रा के लिए इस्तेमाल होता है'),
    ('Privacy policy', 'hi', 'गोपनीयता नीति'),
    ('By continuing you agree to our Privacy policy', 'hi', 'आगे बढ़ने पर आप हमारी गोपनीयता नीति से सहमत होते हैं'),
    ('We couldn''t open the privacy policy. Check your internet and try again.', 'hi', 'हम गोपनीयता नीति नहीं खोल सके। अपना इंटरनेट जाँचकर फिर कोशिश करें।'),
    ('Open in browser', 'hi', 'ब्राउज़र में खोलें')
ON CONFLICT (key, lang) DO NOTHING;
