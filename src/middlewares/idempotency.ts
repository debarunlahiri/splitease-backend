import type { Request, RequestHandler } from 'express';
import { Db, PG_LOCK_NOT_AVAILABLE, pgErrorCode, tx } from '../database';
import { badRequest, conflict } from '../utils/errors';
import { asyncHandler, currentUser, sendResult } from '../utils/http';
import { sha256Hex } from '../utils/tokens';

const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const BUSY = 'Request is still processing; retry with the same Idempotency-Key';

/** Sorts object keys so equivalent JSON bodies produce the same fingerprint. */
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === 'object') {
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(value as object).sort()) {
            sorted[key] = canonical((value as Record<string, unknown>)[key]);
        }
        return sorted;
    }
    return value;
}

/**
 * A write endpoint that requires an Idempotency-Key header. The handler runs in a
 * database transaction that also stores its result, so a retry with the same key and
 * the same request replays the stored response instead of repeating the write.
 */
export function idempotent<T>(
    status: number,
    handler: (req: Request, db: Db) => Promise<T>,
): RequestHandler {
    return asyncHandler(async (req, res) => {
        const key = req.header('idempotency-key');
        if (!key || !KEY.test(key)) {
            throw badRequest(
                'Idempotency-Key is required and must contain 8-128 letters, digits, dots,' +
                    ' colons, underscores or hyphens',
            );
        }
        const userId = currentUser(req).id;
        const keyHash = sha256Hex(key);
        const queryStart = req.originalUrl.indexOf('?');
        const fingerprint = sha256Hex(
            [
                req.method,
                queryStart < 0 ? req.originalUrl : req.originalUrl.slice(0, queryStart),
                queryStart < 0 ? 'null' : req.originalUrl.slice(queryStart + 1),
                JSON.stringify(canonical([userId, req.body ?? null])),
            ].join('\n'),
        );

        let outcome: { replayed: boolean; body: unknown };
        try {
            outcome = await tx(async (db) => {
                // Bound waiting when another instance is still processing the same request.
                await db.query("SET LOCAL lock_timeout = '5s'");
                const inserted = await db.query(
                    `INSERT INTO api_idempotency (user_id, key_hash, fingerprint)
                     VALUES ($1, $2, $3) ON CONFLICT (user_id, key_hash) DO NOTHING`,
                    [userId, keyHash, fingerprint],
                );
                if (inserted.rowCount === 0) {
                    const stored = (
                        await db.query(
                            `SELECT fingerprint, response_json FROM api_idempotency
                             WHERE user_id = $1 AND key_hash = $2 FOR UPDATE`,
                            [userId, keyHash],
                        )
                    ).rows[0];
                    if (!stored || stored.fingerprint !== fingerprint) {
                        throw conflict('Idempotency-Key was already used for a different request');
                    }
                    if (stored.response_json === null) throw conflict(BUSY);
                    return { replayed: true, body: JSON.parse(stored.response_json) };
                }
                const result = await handler(req, db);
                const body = result === undefined ? null : result;
                await db.query(
                    `UPDATE api_idempotency
                     SET response_json = $1, completed_at = CURRENT_TIMESTAMP
                     WHERE user_id = $2 AND key_hash = $3`,
                    [JSON.stringify(body), userId, keyHash],
                );
                return { replayed: false, body };
            });
        } catch (error) {
            if (pgErrorCode(error) === PG_LOCK_NOT_AVAILABLE) throw conflict(BUSY);
            throw error;
        }
        if (outcome.replayed) res.setHeader('Idempotency-Replayed', 'true');
        sendResult(res, status, outcome.body);
    });
}
