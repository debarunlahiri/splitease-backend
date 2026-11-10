import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { isUuid } from '../utils/http';

const PUBLIC_PATHS = [
    '/api/v1/auth/',
    // The app checks for updates before anyone is signed in.
    '/api/v1/app/',
    '/api/v1/ios-updates/',
    '/api/v1/subscriptions/plans',
    '/api/v1/subscriptions/webhooks/',
];

/**
 * Requires a valid bearer access token on every /api route that is not public and
 * exposes its claims as req.user. Identity never comes from caller-supplied headers.
 */
export const authenticate: RequestHandler = (req, res, next) => {
    const path = req.path;
    if (!path.startsWith('/api/') || PUBLIC_PATHS.some((prefix) => path.startsWith(prefix))) {
        next();
        return;
    }
    const authorization = req.header('authorization');
    if (!authorization || !authorization.startsWith('Bearer ')) {
        res.status(401).end();
        return;
    }
    try {
        const claims = jwt.verify(authorization.slice(7), config.jwt.secret, {
            algorithms: ['HS256', 'HS384', 'HS512'],
        });
        if (typeof claims === 'string' || !isUuid(claims.sub)) {
            res.status(401).end();
            return;
        }
        req.user = {
            id: claims.sub.toLowerCase(),
            email: typeof claims.email === 'string' ? claims.email : '',
        };
        next();
    } catch {
        res.status(401).end();
    }
};
