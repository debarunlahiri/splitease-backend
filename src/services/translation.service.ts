import { Db } from '../database';
import { badRequest, notFound } from '../utils/errors';

export interface LanguageView {
    code: string;
    name: string;
    nativeName: string;
    enabled: boolean;
}

/** Languages the app offers (English is always first and always on). */
export async function listLanguages(db: Db, includeDisabled = false): Promise<LanguageView[]> {
    const rows = (
        await db.query(
            `SELECT code, name, native_name, enabled FROM app_languages
             WHERE ($1 OR enabled OR code = 'en') ORDER BY sort_order, code`,
            [includeDisabled],
        )
    ).rows;
    return rows.map((r: any) => ({ code: r.code, name: r.name, nativeName: r.native_name, enabled: r.enabled }));
}

async function requireLanguage(db: Db, code: string): Promise<void> {
    const found = (await db.query('SELECT 1 FROM app_languages WHERE code = $1', [code])).rows[0];
    if (!found) throw notFound('Unknown language');
}

/** Public: every translated string for a language. `version` changes whenever any of them does. */
export async function stringsFor(db: Db, lang: string) {
    await requireLanguage(db, lang);
    const rows = (
        await db.query('SELECT key, value, updated_at FROM app_string_translations WHERE lang = $1', [lang])
    ).rows;
    const strings: Record<string, string> = {};
    let version = 0;
    for (const row of rows) {
        strings[row.key] = row.value;
        version = Math.max(version, new Date(row.updated_at).getTime());
    }
    return { lang, version: String(version), strings };
}

export interface StringRow {
    key: string;
    value: string | null;
}

/** Admin: every string with its translation for [lang] (null when missing), optionally filtered. */
export async function adminStrings(db: Db, lang: string, q: string | undefined, onlyMissing: boolean) {
    await requireLanguage(db, lang);
    const rows = (
        await db.query(
            `SELECT s.key, t.value FROM app_strings s
             LEFT JOIN app_string_translations t ON t.key = s.key AND t.lang = $1
             WHERE ($2::text IS NULL OR s.key ILIKE $2 OR t.value ILIKE $2)
               AND (NOT $3 OR t.value IS NULL)
             ORDER BY s.key ASC LIMIT 1000`,
            [lang, q ? `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null, onlyMissing],
        )
    ).rows;
    const total = (await db.query('SELECT COUNT(*)::int AS n FROM app_strings')).rows[0].n;
    const translated = (
        await db.query('SELECT COUNT(*)::int AS n FROM app_string_translations WHERE lang = $1', [lang])
    ).rows[0].n;
    return { items: rows as StringRow[], total, translated };
}

/** Admin: add or change one translation; an empty value removes it (the app then shows English). */
export async function saveTranslation(db: Db, lang: string, key: string, value: string) {
    await requireLanguage(db, lang);
    await db.query('INSERT INTO app_strings (key) VALUES ($1) ON CONFLICT DO NOTHING', [key]);
    if (!value.trim()) {
        await db.query('DELETE FROM app_string_translations WHERE key = $1 AND lang = $2', [key, lang]);
        return { key, value: null };
    }
    await db.query(
        `INSERT INTO app_string_translations (key, lang, value, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (key, lang) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, lang, value.trim()],
    );
    return { key, value: value.trim() };
}

export async function deleteString(db: Db, key: string) {
    const result = await db.query('DELETE FROM app_strings WHERE key = $1', [key]);
    if (result.rowCount === 0) throw notFound('String not found');
}

export async function setLanguageEnabled(db: Db, code: string, enabled: boolean) {
    if (code === 'en' && !enabled) throw badRequest('English cannot be turned off');
    const result = await db.query('UPDATE app_languages SET enabled = $1 WHERE code = $2', [enabled, code]);
    if (result.rowCount === 0) throw notFound('Unknown language');
}
