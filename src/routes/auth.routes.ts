import { Router } from 'express';
import * as auth from '../controllers/auth.controller';
import { route } from '../utils/http';

export const authRouter = Router();

authRouter.post('/register', route(201, auth.register));
authRouter.post('/login', route(200, auth.login));
authRouter.post('/refresh', route(200, auth.refresh));
authRouter.post('/logout', route(204, auth.logout));
authRouter.post('/verify-email', route(204, auth.verifyEmail));
authRouter.post('/resend-verification', route(202, auth.resendVerification));
authRouter.get('/firebase/status', route(200, auth.firebaseStatus));
authRouter.post('/firebase', route(200, auth.firebaseLogin));
