-- Hindi wording for the friendlier error messages.
INSERT INTO app_strings (key) VALUES
    ('Can''t reach SplitEase. Check your internet and try again.'),
    ('Couldn''t sign you in. Please try again.'),
    ('Something doesn''t look right. Please check what you entered and try again.'),
    ('Your session has ended. Please sign in again.'),
    ('You can''t do that here. Ask the person who created it to help.'),
    ('We couldn''t find that. It may have been removed, so try refreshing.'),
    ('That''s taking a while. Check your internet and try again.'),
    ('This changed while you were looking. Refresh and try again.'),
    ('You''re going a little fast. Wait a moment and try again.'),
    ('Something went wrong on our side. Please try again in a few minutes.')
ON CONFLICT DO NOTHING;

INSERT INTO app_string_translations (key, lang, value) VALUES
    ('Can''t reach SplitEase. Check your internet and try again.', 'hi', 'SplitEase तक नहीं पहुँच पा रहे। अपना इंटरनेट जाँचकर फिर कोशिश करें।'),
    ('Couldn''t sign you in. Please try again.', 'hi', 'आपको साइन इन नहीं कर सके। कृपया फिर कोशिश करें।'),
    ('Something doesn''t look right. Please check what you entered and try again.', 'hi', 'कुछ ठीक नहीं लग रहा। कृपया जो लिखा है उसे जाँचकर फिर कोशिश करें।'),
    ('Your session has ended. Please sign in again.', 'hi', 'आपका सत्र ख़त्म हो गया है। कृपया फिर साइन इन करें।'),
    ('You can''t do that here. Ask the person who created it to help.', 'hi', 'आप यहाँ यह नहीं कर सकते। इसे बनाने वाले से मदद माँगें।'),
    ('We couldn''t find that. It may have been removed, so try refreshing.', 'hi', 'हमें यह नहीं मिला। हो सकता है यह हटा दिया गया हो, इसलिए ताज़ा करके देखें।'),
    ('That''s taking a while. Check your internet and try again.', 'hi', 'इसमें कुछ समय लग रहा है। अपना इंटरनेट जाँचकर फिर कोशिश करें।'),
    ('This changed while you were looking. Refresh and try again.', 'hi', 'आपके देखते-देखते यह बदल गया। ताज़ा करके फिर कोशिश करें।'),
    ('You''re going a little fast. Wait a moment and try again.', 'hi', 'आप थोड़ा तेज़ चल रहे हैं। थोड़ा रुककर फिर कोशिश करें।'),
    ('Something went wrong on our side. Please try again in a few minutes.', 'hi', 'हमारी तरफ़ कुछ गड़बड़ हो गई। कृपया कुछ मिनट बाद फिर कोशिश करें।')
ON CONFLICT (key, lang) DO NOTHING;
