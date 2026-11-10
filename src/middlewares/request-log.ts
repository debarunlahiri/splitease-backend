import { randomUUID } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { config } from '../config';
import { logger } from '../utils/logger';

const SAFE_QUERY = new Set(['page', 'size', 'currency']);
const SENSITIVE = [
    'password',
    'token',
    'inviteurl',
    'secret',
    'credential',
    'authorization',
    'cookie',
    'email',
    'phone',
    'address',
    'name',
    'notes',
    'description',
    'message',
    'receipt',
    'photo',
    'signedpayload',
];

export function isSensitiveKey(key: string): boolean {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    return SENSITIVE.some((word) => normalized.includes(word));
}

export function redact(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(redact);
    if (value !== null && typeof value === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value as object)) {
            result[key] = isSensitiveKey(key) ? '[REDACTED]' : redact(entry);
        }
        return result;
    }
    return value;
}

function loggableBody(path: string, body: unknown): unknown {
    if (Buffer.isBuffer(body)) return '[BINARY BODY OMITTED]';
    if (path.startsWith('/api/v1/auth/') || path.includes('/webhooks/')) {
        return '[AUTHENTICATION/WEBHOOK BODY OMITTED]';
    }
    if (body === undefined || body === null) return null;
    if (typeof body !== 'object') return '[NON-JSON/ENCODED BODY OMITTED]';
    if (Object.keys(body).length === 0 && !Array.isArray(body)) return null;
    try {
        // Round-trip first so Dates and other values are logged exactly as sent.
        const serialized = JSON.stringify(body);
        if (serialized.length > config.apiLog.bodyLimit) return '[BODY EXCEEDS CAPTURE LIMIT]';
        return redact(JSON.parse(serialized));
    } catch {
        return '[UNPARSEABLE BODY OMITTED]';
    }
}

function loggableQuery(req: Request): Record<string, unknown> {
    const query: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(req.query)) {
        query[key] = SAFE_QUERY.has(key) ? value : '[REDACTED]';
    }
    return query;
}

/** Assigns a request id and writes one sanitized API_AUDIT line per /api request. */
export const requestLog: RequestHandler = (req, res, next) => {
    const requestId = randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    if (!config.apiLog.enabled || !req.path.startsWith('/api/')) {
        next();
        return;
    }
    const path = req.path;
    const startedAt = new Date();
    const started = process.hrtime.bigint();
    let responseBody: unknown;
    const json = res.json.bind(res);
    res.json = ((body?: unknown) => {
        responseBody = body;
        return json(body);
    }) as typeof res.json;
    let logged = false;
    const write = (outcome: string) => {
        if (logged) return;
        logged = true;
        try {
            const entry = {
                requestId,
                startedAt: startedAt.toISOString(),
                completedAt: new Date().toISOString(),
                method: req.method,
                path,
                query: loggableQuery(req),
                clientAddress: req.ip ?? null,
                userId: req.user?.id ?? null,
                status: outcome === 'CANCEL' ? 499 : res.statusCode,
                durationMs: Number(process.hrtime.bigint() - started) / 1_000_000,
                outcome,
                requestContentType: req.header('content-type') ?? null,
                responseContentType: res.getHeader('content-type') ?? null,
                requestBody: loggableBody(path, req.body),
                responseBody: loggableBody(path, responseBody),
            };
            logger.info(`API_AUDIT ${JSON.stringify(entry)}`);
        } catch (failure) {
            logger.error(`API audit serialization failed; requestId=${requestId}`, failure);
        }
    };
    res.on('finish', () => write('ON_COMPLETE'));
    res.on('close', () => write('CANCEL'));
    next();
};
