import { Router } from 'express';
import * as app from '../controllers/app.controller';
import { route } from '../utils/http';

export const appRouter = Router();

appRouter.get('/version', route(200, app.androidVersion));
