import { Pool, types } from 'pg';
import { config } from '../config';
import { logger } from '../utils/logger';

// BIGINT (revision, COUNT(*)) as a JS number; DATE as a plain YYYY-MM-DD string.
// NUMERIC stays a string and TIMESTAMPTZ becomes a Date (pg defaults).
types.setTypeParser(20, (value: string) => parseInt(value, 10));
types.setTypeParser(1082, (value: string) => value);

export interface QueryResult {
    rows: any[];
    rowCount: number;
}

/** Either the shared pool or one transaction's connection. */
export interface Db {
    query(text: string, params?: unknown[]): Promise<QueryResult>;
}

export const pool = new Pool({
    connectionString: config.database.url,
    max: config.database.poolMax,
    idleTimeoutMillis: 60_000,
});

pool.on('error', (error: Error) => {
    logger.error('Idle database connection failed', error);
});

/** Auto-commit queries on the pool. */
export const db: Db = {
    async query(text, params) {
        const result = await pool.query(text, params as any[] | undefined);
        return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    },
};

/** Runs `work` in one transaction: commits on return, rolls back on throw. */
export async function tx<T>(work: (db: Db) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    const connection: Db = {
        async query(text, params) {
            const result = await client.query(text, params as any[] | undefined);
            return { rows: result.rows, rowCount: result.rowCount ?? 0 };
        },
    };
    let broken = false;
    try {
        await client.query('BEGIN');
        const result = await work(connection);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch {
            broken = true;
        }
        throw error;
    } finally {
        client.release(broken);
    }
}

/** Transaction-scoped lock that also serializes work across server instances. */
export async function advisoryLock(db: Db, key: string): Promise<void> {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
}

export function pgErrorCode(error: unknown): string | undefined {
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === 'string' ? code : undefined;
}

export const PG_UNIQUE_VIOLATION = '23505';
export const PG_LOCK_NOT_AVAILABLE = '55P03';
