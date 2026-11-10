import { db } from '../database';

export interface AppVersionInfo {
    platform: 'android';
    /** 0 means no update is published. */
    latestVersionCode: number;
    latestVersionName: string;
    minSupportedVersionCode: number;
    apkUrl: string | null;
    apkSha256: string | null;
    releaseNotes: string;
}

const NONE: AppVersionInfo = {
    platform: 'android',
    latestVersionCode: 0,
    latestVersionName: '',
    minSupportedVersionCode: 0,
    apkUrl: null,
    apkSha256: null,
    releaseNotes: '',
};

/**
 * What the Android app needs to decide whether to offer an update: the newest published row of
 * the app_versions table. Public: no sign-in, because the check runs before anyone signs in.
 */
export const androidVersion = async (): Promise<AppVersionInfo> => {
    const row = (
        await db.query(
            `SELECT version_code, version_name, min_supported_version_code, apk_url, apk_sha256,
                    release_notes
             FROM app_versions
             WHERE platform = 'android' AND published
             ORDER BY version_code DESC LIMIT 1`,
        )
    ).rows[0];
    if (!row) return NONE;
    return {
        platform: 'android',
        latestVersionCode: row.version_code,
        latestVersionName: row.version_name,
        minSupportedVersionCode: row.min_supported_version_code,
        apkUrl: row.apk_url,
        apkSha256: row.apk_sha256 ? row.apk_sha256.trim() : null,
        releaseNotes: row.release_notes,
    };
};
