// Adds the fields our middleware sets on every request.
declare namespace Express {
    interface Request {
        /** The caller, set by the authenticate middleware from the access token. */
        user?: { id: string; email: string };
        /** Set by the request-log middleware and echoed in the X-Request-Id header. */
        requestId?: string;
    }
}
