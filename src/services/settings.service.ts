import { Db } from '../database';

export type PhoneVerificationMode = 'DEFAULT' | 'REQUIRED' | 'NOT_REQUIRED';

export async function getBool(db: Db, key: string, fallback: boolean): Promise<boolean> {
    const row = (await db.query('SELECT value FROM app_settings WHERE key = $1', [key])).rows[0];
    return row ? row.value === 'true' : fallback;
}

export async function setBool(db: Db, key: string, value: boolean): Promise<void> {
    await db.query(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, value ? 'true' : 'false'],
    );
}

/** The switch for everyone; a person's own setting (when they have one) overrides it. */
export const phoneVerificationRequiredForAll = (db: Db) => getBool(db, 'phone_verification_required', true);

export async function phoneVerificationRequired(db: Db, userId: string): Promise<boolean> {
    const own = (await db.query('SELECT phone_verification FROM users WHERE id = $1', [userId])).rows[0]
        ?.phone_verification as string | null | undefined;
    if (own === 'REQUIRED') return true;
    if (own === 'NOT_REQUIRED') return false;
    return phoneVerificationRequiredForAll(db);
}
