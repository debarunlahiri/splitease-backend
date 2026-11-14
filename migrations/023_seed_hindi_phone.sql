-- Hindi wording for the phone number and message-reminder screens.
INSERT INTO app_strings (key) VALUES
    ('Phone number'),
    ('Friends who have your number can find you. Always saved with the country code.'),
    ('Enter a valid phone number.'),
    ('Save phone number'),
    ('{name} isn''t on SplitEase yet, so the message goes from your phone.')
ON CONFLICT DO NOTHING;

INSERT INTO app_string_translations (key, lang, value) VALUES
    ('Phone number', 'hi', 'फ़ोन नंबर'),
    ('Friends who have your number can find you. Always saved with the country code.', 'hi', 'जिन दोस्तों के पास आपका नंबर है, वे आपको ढूँढ सकते हैं। नंबर हमेशा देश के कोड के साथ सेव होता है।'),
    ('Enter a valid phone number.', 'hi', 'सही फ़ोन नंबर लिखें।'),
    ('Save phone number', 'hi', 'फ़ोन नंबर सेव करें'),
    ('{name} isn''t on SplitEase yet, so the message goes from your phone.', 'hi', '{name} अभी SplitEase पर नहीं हैं, इसलिए संदेश आपके फ़ोन से जाएगा।')
ON CONFLICT (key, lang) DO NOTHING;
