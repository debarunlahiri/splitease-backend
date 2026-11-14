-- Hindi wording for removing people and friends.
INSERT INTO app_strings (key) VALUES
    ('Remove'),
    ('Got it'),
    ('Remove friend'),
    ('Removed from this Splits.'),
    ('Friend removed.'),
    ('Remove {0}?'),
    ('{0} is already in 1 split'),
    ('{0} is already in {1} splits'),
    ('{0} isn''t in any split yet, so nothing changes for anyone else.'),
    ('To remove them, first take them out of these splits or delete the splits.'),
    ('{0} · paid by them'),
    ('You will no longer be friends. Splits you already share stay as they are.'),
    ('Add by phone number'),
    ('Send the invite on WhatsApp or SMS.'),
    ('We''ll open WhatsApp or SMS with an invite ready to send.'),
    ('Phone number'),
    ('Send on WhatsApp'),
    ('Send as SMS')
ON CONFLICT DO NOTHING;

INSERT INTO app_string_translations (key, lang, value) VALUES
    ('Remove', 'hi', 'हटाएँ'),
    ('Got it', 'hi', 'ठीक है'),
    ('Remove friend', 'hi', 'दोस्त हटाएँ'),
    ('Removed from this Splits.', 'hi', 'इस स्प्लिट्स से हटा दिया गया।'),
    ('Friend removed.', 'hi', 'दोस्त हटा दिया गया।'),
    ('Remove {0}?', 'hi', '{0} को हटाएँ?'),
    ('{0} is already in 1 split', 'hi', '{0} पहले से 1 स्प्लिट में है'),
    ('{0} is already in {1} splits', 'hi', '{0} पहले से {1} स्प्लिट में है'),
    ('{0} isn''t in any split yet, so nothing changes for anyone else.', 'hi', '{0} अभी किसी स्प्लिट में नहीं हैं, इसलिए बाक़ी किसी के लिए कुछ नहीं बदलेगा।'),
    ('To remove them, first take them out of these splits or delete the splits.', 'hi', 'उन्हें हटाने के लिए पहले इन स्प्लिट से उन्हें निकालें या इन स्प्लिट को हटा दें।'),
    ('{0} · paid by them', 'hi', '{0} · उन्होंने चुकाया'),
    ('You will no longer be friends. Splits you already share stay as they are.', 'hi', 'आप अब दोस्त नहीं रहेंगे। जो स्प्लिट आप पहले से साझा करते हैं, वे जैसे हैं वैसे रहेंगे।'),
    ('Add by phone number', 'hi', 'फ़ोन नंबर से जोड़ें'),
    ('Send the invite on WhatsApp or SMS.', 'hi', 'न्योता WhatsApp या SMS पर भेजें।'),
    ('We''ll open WhatsApp or SMS with an invite ready to send.', 'hi', 'हम WhatsApp या SMS खोलेंगे, न्योता भेजने के लिए तैयार होगा।'),
    ('Phone number', 'hi', 'फ़ोन नंबर'),
    ('Send on WhatsApp', 'hi', 'WhatsApp पर भेजें'),
    ('Send as SMS', 'hi', 'SMS से भेजें')
ON CONFLICT (key, lang) DO NOTHING;
