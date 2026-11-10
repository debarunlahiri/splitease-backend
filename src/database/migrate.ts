import fs from 'node:fs';
import path from 'node:path';
import { advisoryLock, pool, tx } from '.';
import { logger } from '../utils/logger';

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

/** Applies every not-yet-applied .sql file in ./migrations, in file-name order. */
export async function migrate(): Promise<void> {
    const files = fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((file) => file.endsWith('.sql'))
        .sort();
    await tx(async (db) => {
        await advisoryLock(db, 'schema-migrations');
        await db.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version VARCHAR(200) PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            )`);
        const applied = new Set<string>(
            (await db.query('SELECT version FROM schema_migrations')).rows.map(
                (row) => row.version,
            ),
        );
        for (const file of files) {
            if (applied.has(file)) continue;
            logger.info(`Applying migration ${file}`);
            await db.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
            await db.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        }
    });
}

if (require.main === module) {
    migrate()
        .then(() => {
            logger.info('Migrations are up to date');
            return pool.end();
        })
        .catch((error) => {
            logger.error('Migration failed', error);
            process.exit(1);
        });
}
