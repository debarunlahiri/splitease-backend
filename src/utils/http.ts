import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { badRequest } from './errors';

export interface AuthUser {
    id: string;
    email: string;
}

export function asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
    return (req, res, next) => {
        handler(req, res, next).catch(next);
    };
}

export function sendResult(res: Response, status: number, result: unknown): void {
    if (result === undefined || result === null) {
        res.status(status).end();
    } else {
        res.status(status).json(result);
    }
}

/** A JSON endpoint: the returned value is the body; undefined sends an empty response. */
export function route<T>(status: number, handler: (req: Request) => Promise<T>): RequestHandler {
    return asyncHandler(async (req, res) => {
        sendResult(res, status, await handler(req));
    });
}

/** The caller established by the authentication middleware. */
export function currentUser(req: Request): AuthUser {
    if (!req.user) throw badRequest('Authenticated user id is required');
    return req.user;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
    return typeof value === 'string' && UUID.test(value);
}

export function uuidParam(req: Request, name: string): string {
    const value = req.params[name];
    if (!isUuid(value)) throw badRequest(`${name} must be a valid UUID`);
    return value.toLowerCase();
}

export interface PageRequest {
    page: number;
    size: number;
    offset: number;
}

function intQuery(req: Request, name: string, fallback: number): number {
    const raw = req.query[name];
    if (raw === undefined || raw === '') return fallback;
    if (typeof raw !== 'string' || !/^-?\d{1,9}$/.test(raw)) {
        throw badRequest(`${name} must be an integer`);
    }
    return parseInt(raw, 10);
}

export function pageRequest(req: Request): PageRequest {
    const page = intQuery(req, 'page', 0);
    const size = intQuery(req, 'size', 20);
    if (page < 0 || size < 1 || size > 100) {
        throw badRequest('Page must be nonnegative and size must be between 1 and 100');
    }
    return { page, size, offset: page * size };
}

export interface PageResponse<T> {
    items: T[];
    page: number;
    size: number;
    totalItems: number;
    totalPages: number;
}

export function pageResponse<T>(items: T[], page: PageRequest, totalItems: number): PageResponse<T> {
    return {
        items,
        page: page.page,
        size: page.size,
        totalItems,
        totalPages: Math.ceil(totalItems / page.size),
    };
}
