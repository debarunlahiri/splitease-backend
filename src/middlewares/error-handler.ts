import type { ErrorRequestHandler, RequestHandler } from 'express';
import { PG_UNIQUE_VIOLATION, pgErrorCode } from '../database';
import { HttpError } from '../utils/errors';
import { logger } from '../utils/logger';

function body(status: number, code: string, message: string, fieldErrors = {}) {
    return { timestamp: new Date().toISOString(), status, code, message, fieldErrors };
}

export const notFoundHandler: RequestHandler = (_req, res) => {
    res.status(404).json(body(404, 'NOT_FOUND', 'Resource not found'));
};

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
    if (res.headersSent) {
        next(error);
        return;
    }
    if (error instanceof HttpError) {
        res.status(error.status).json(
            body(error.status, error.code, error.message, error.fieldErrors),
        );
        return;
    }
    // Raised by express.json() for malformed or oversized bodies.
    const type = (error as { type?: unknown } | null)?.type;
    if (type === 'entity.parse.failed') {
        res.status(400).json(body(400, 'INVALID_REQUEST', 'Malformed JSON request body'));
        return;
    }
    if (type === 'entity.too.large') {
        res.status(413).json(body(413, 'HTTP_413', 'Request body is too large'));
        return;
    }
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
        res.status(409).json(body(409, 'CONFLICT', 'Request conflicts with existing data'));
        return;
    }
    logger.error(`Unhandled error [requestId:${req.requestId ?? 'none'}]`, error);
    res.status(500).json(body(500, 'INTERNAL_ERROR', 'Unexpected server error'));
};
