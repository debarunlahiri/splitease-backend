import { Router } from 'express';
import * as app from '../controllers/app.controller';
import { config } from '../config';
import { db } from '../database';
import { route } from '../utils/http';
import { listLanguages, stringsFor } from '../services/translation.service';

export const appRouter = Router();

appRouter.get('/version', route(200, app.androidVersion));

/** Where the public website lives, so the app can build links that open for people without the app. */
appRouter.get('/links', route(200, async () => ({ webUrl: config.appUrls[0] })));

/** Languages the app can switch to, and the translated text for one of them (no sign-in needed). */
appRouter.get('/languages', route(200, () => listLanguages(db)));
appRouter.get('/strings/:lang', route(200, (req) => {
    const lang = String(req.params.lang);
    return stringsFor(db, /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(lang) ? lang : 'en');
}));
