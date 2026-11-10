import type { RequestHandler } from 'express';
import { config } from '../config';

export const cors: RequestHandler = (req, res, next) => {
    res.vary('Origin');

    const origin = req.get('Origin');
    if (!origin || !config.appUrls.includes(origin)) {
        next();
        return;
    }

    res.set('Access-Control-Allow-Origin', origin);

    if (req.method === 'OPTIONS' && req.get('Access-Control-Request-Method')) {
        res.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key');
        res.status(204).end();
        return;
    }

    res.set('Access-Control-Expose-Headers', 'X-Request-Id');
    next();
};
