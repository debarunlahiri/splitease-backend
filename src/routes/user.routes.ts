import { Router } from 'express';
import * as auth from '../controllers/auth.controller';
import { idempotent } from '../middlewares/idempotency';
import { route } from '../utils/http';

export const usersRouter = Router();

usersRouter.get('/me', route(200, auth.me));
usersRouter.patch('/me', idempotent(200, auth.updateDisplayName));
usersRouter.put('/me/upi', idempotent(200, auth.updateUpiId));
usersRouter.post('/me/upi/confirm', idempotent(200, auth.confirmUpiId));
