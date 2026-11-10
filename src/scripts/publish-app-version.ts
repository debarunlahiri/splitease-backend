import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { pool } from '../database';
import { migrate } from '../database/migrate';

/**
 * Publishes (or updates) an Android release in the app_versions table.
 *
 *   npm run app-version -- --code 2 --name 1.1 --url https://example.com/splitease.apk \
 *       --apk ./splitease.apk --min 1 --notes "Faster balances\nBug fixes"
 *   npm run app-version -- --unpublish 2
 *   npm run app-version -- --list
 */

const USAGE = `Usage:
  npm run app-version -- --code <n> --name <text> --url <apk-url> [--apk <file> | --sha256 <hex>]
                         [--min <n>] [--notes <text>]
  npm run app-version -- --unpublish <code>
  npm run app-version -- --list

  --code     versionCode of the build (must be higher than any installed version to be offered)
  --name     versionName shown to users, e.g. 1.1
  --url      public address of the APK
  --apk      local APK file; its SHA-256 is computed for you
  --sha256   SHA-256 of the APK (64 hex characters), if you do not pass --apk
  --min      installed versions below this must update before using the app (default 0)
  --notes    release notes; \\n makes a new line`;

function parse(argv: string[]): Map<string, string> {
    const args = new Map<string, string>();
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
            args.set(key, '');
        } else {
            args.set(key, next);
            i++;
        }
    }
    return args;
}

function positive(value: string | undefined, name: string): number {
    if (!value || !/^\d+$/.test(value) || Number(value) <= 0) {
        throw new Error(`--${name} must be a positive whole number`);
    }
    return Number(value);
}

async function main(): Promise<void> {
    const args = parse(process.argv.slice(2));
    if (args.has('help') || process.argv.length <= 2) {
        console.log(USAGE);
        return;
    }
    await migrate();

    if (args.has('list')) {
        const rows = (
            await pool.query(
                `SELECT version_code, version_name, min_supported_version_code, published, created_at
                 FROM app_versions WHERE platform = 'android' ORDER BY version_code DESC`,
            )
        ).rows;
        if (rows.length === 0) console.log('No versions published.');
        for (const row of rows) {
            console.log(
                `${row.published ? 'published  ' : 'unpublished'} code ${row.version_code}` +
                    `  name ${row.version_name || '-'}  min ${row.min_supported_version_code}`,
            );
        }
        return;
    }

    if (args.has('unpublish')) {
        const code = positive(args.get('unpublish'), 'unpublish');
        const result = await pool.query(
            "UPDATE app_versions SET published = FALSE WHERE platform = 'android' AND version_code = $1",
            [code],
        );
        console.log(
            result.rowCount ? `Version code ${code} is no longer offered.` : `No version with code ${code}.`,
        );
        return;
    }

    const code = positive(args.get('code'), 'code');
    const name = (args.get('name') ?? '').trim();
    if (!name) throw new Error('--name is required');
    const url = (args.get('url') ?? '').trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('--url must be an http(s) address');
    const min = args.has('min') ? Number(args.get('min')) : 0;
    if (!Number.isInteger(min) || min < 0 || min > code) {
        throw new Error('--min must be a whole number from 0 up to --code');
    }

    let sha256 = (args.get('sha256') ?? '').trim().toLowerCase();
    const apk = args.get('apk');
    if (apk) {
        sha256 = createHash('sha256').update(fs.readFileSync(apk)).digest('hex');
        console.log(`SHA-256 of ${apk}: ${sha256}`);
    }
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
        throw new Error('Give --apk <file> or --sha256 <64 hex characters> so downloads can be verified');
    }
    const notes = (args.get('notes') ?? '').replace(/\\n/g, '\n').trim();

    await pool.query(
        `INSERT INTO app_versions
             (id, platform, version_code, version_name, min_supported_version_code, apk_url,
              apk_sha256, release_notes, published)
         VALUES ($1, 'android', $2, $3, $4, $5, $6, $7, TRUE)
         ON CONFLICT (platform, version_code) DO UPDATE SET
             version_name = EXCLUDED.version_name,
             min_supported_version_code = EXCLUDED.min_supported_version_code,
             apk_url = EXCLUDED.apk_url,
             apk_sha256 = EXCLUDED.apk_sha256,
             release_notes = EXCLUDED.release_notes,
             published = TRUE`,
        [randomUUID(), code, name, min, url, sha256, notes],
    );
    console.log(`Published Android version ${name} (code ${code}).`);
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
