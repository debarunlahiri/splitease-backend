import express from 'express';
import { authenticate } from './middlewares/authenticate';
import { cors } from './middlewares/cors';
import { errorHandler, notFoundHandler } from './middlewares/error-handler';
import { requestLog } from './middlewares/request-log';
import { routes } from './routes';

export function createApp(): express.Express {
    const app = express();
    app.disable('x-powered-by');

    app.use(requestLog);
    app.use(cors);
    app.use(express.json({ limit: '1mb' }));
    app.use(authenticate);

    app.use(routes);

    app.use(notFoundHandler);
    app.use(errorHandler);
    return app;
}
