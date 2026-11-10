import { Router } from 'express';
import { z } from 'zod';
import { advisoryLock, db, tx } from '../database';
import { mailEnabled, queueIosUpdateConfirmation } from '../services/mail.service';
import { badRequest, tooManyRequests, unavailable } from '../utils/errors';
import { route } from '../utils/http';
import { generateToken, sha256Hex } from '../utils/tokens';
import { email, parseBody } from '../validators/common';

const Subscribe = z.object({ email });
const Confirm = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

export const iosUpdateRouter = Router();

iosUpdateRouter.post('/subscribe', route(204, async (req) => {
    const recipient = parseBody(Subscribe, req.body).email.trim().toLowerCase();
    if (!mailEnabled()) throw unavailable();
    await tx(async (conn) => {
        await advisoryLock(conn, 'ios-update-subscriptions');
        const recent = (
            await conn.query(
                `SELECT COUNT(*) AS total FROM ios_update_subscriptions
                 WHERE requested_at > CURRENT_TIMESTAMP - INTERVAL '1 hour'`,
            )
        ).rows[0].total;
        if (recent >= 50) throw tooManyRequests('Please try again later');

        const token = generateToken();
        const result = await conn.query(
            `INSERT INTO ios_update_subscriptions (email, token_hash, requested_at)
             VALUES ($1, $2, CURRENT_TIMESTAMP)
             ON CONFLICT (email) DO UPDATE
             SET token_hash = EXCLUDED.token_hash, requested_at = EXCLUDED.requested_at
             WHERE ios_update_subscriptions.confirmed_at IS NULL
               AND ios_update_subscriptions.requested_at < CURRENT_TIMESTAMP - INTERVAL '1 hour'`,
            [recipient, sha256Hex(token)],
        );
        if (result.rowCount === 1) await queueIosUpdateConfirmation(conn, recipient, token);
    });
}));

iosUpdateRouter.post('/confirm', route(204, async (req) => {
    const { token } = parseBody(Confirm, req.body);
    const result = await db.query(
        `UPDATE ios_update_subscriptions
         SET confirmed_at = COALESCE(confirmed_at, CURRENT_TIMESTAMP)
         WHERE token_hash = $1
           AND (confirmed_at IS NOT NULL OR requested_at > CURRENT_TIMESTAMP - INTERVAL '1 day')`,
        [sha256Hex(token)],
    );
    if (result.rowCount !== 1) throw badRequest('Invalid or expired confirmation link');
}));
