import { db } from '../database';
import { asyncHandler } from '../utils/http';

export const health = asyncHandler(async (_req, res) => {
    try {
        await db.query('SELECT 1');
        res.json({ status: 'UP' });
    } catch {
        res.status(503).json({ status: 'DOWN' });
    }
});
