import { Router } from 'express';
import * as app from '../controllers/app.controller';
import { config } from '../config';
import { route } from '../utils/http';

export const appRouter = Router();

appRouter.get('/version', route(200, app.androidVersion));

/** Where the public website lives, so the app can build links that open for people without the app. */
appRouter.get('/links', route(200, async () => ({ webUrl: config.appUrls[0] })));
