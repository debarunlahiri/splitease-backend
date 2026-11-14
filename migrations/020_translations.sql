-- App languages and the text shown in them. The English wording itself is the key, so the app can wrap its
-- own text and any string without a translation simply stays in English.
CREATE TABLE app_languages (
    code VARCHAR(10) PRIMARY KEY,
    name VARCHAR(60) NOT NULL,
    native_name VARCHAR(60) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INT NOT NULL DEFAULT 0
);
INSERT INTO app_languages (code, name, native_name, sort_order) VALUES
    ('en', 'English', 'English', 0),
    ('hi', 'Hindi', 'हिन्दी', 1);

CREATE TABLE app_strings (
    key TEXT PRIMARY KEY CHECK (char_length(key) BETWEEN 1 AND 500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE app_string_translations (
    key TEXT NOT NULL REFERENCES app_strings(key) ON DELETE CASCADE,
    lang VARCHAR(10) NOT NULL REFERENCES app_languages(code) ON DELETE CASCADE,
    value TEXT NOT NULL CHECK (char_length(value) BETWEEN 1 AND 1000),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (key, lang)
);
