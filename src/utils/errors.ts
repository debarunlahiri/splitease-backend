/** An error that maps to the API error body: { timestamp, status, code, message, fieldErrors }. */
export class HttpError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string,
        readonly fieldErrors: Record<string, string> = {},
    ) {
        super(message);
    }
}

export const badRequest = (message: string) => new HttpError(400, 'INVALID_REQUEST', message);
export const validationFailed = (fieldErrors: Record<string, string>) =>
    new HttpError(400, 'VALIDATION_FAILED', 'Request validation failed', fieldErrors);
export const badCredentials = (message: string) =>
    new HttpError(401, 'INVALID_CREDENTIALS', message);
export const forbidden = (message: string) => new HttpError(403, 'FORBIDDEN', message);
export const notFound = (message: string) => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (message: string) => new HttpError(409, 'CONFLICT', message);
export const tooManyRequests = (message: string) =>
    new HttpError(429, 'TOO_MANY_REQUESTS', message);
export const unavailable = (
    message = 'This service is temporarily unavailable. Please try again later.',
) => new HttpError(503, 'HTTP_503', message);
