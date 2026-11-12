import type { Request } from 'express';
import type { Db } from '../database';
import * as auth from '../services/auth.service';
import { currentUser } from '../utils/http';
import {
    FirebaseLogin,
    Login,
    RefreshToken,
    Register,
    ResendVerification,
    UpdateDisplayName,
    UpdateUpiId,
    VerifyEmail,
} from '../validators/auth.validator';
import { parseBody } from '../validators/common';

export const register = (req: Request) => auth.register(parseBody(Register, req.body));
export const login = (req: Request) => auth.login(parseBody(Login, req.body));
export const refresh = (req: Request) => auth.refresh(parseBody(RefreshToken, req.body));
export const logout = (req: Request) => auth.logout(parseBody(RefreshToken, req.body));
export const verifyEmail = (req: Request) => auth.verifyEmail(parseBody(VerifyEmail, req.body));
export const resendVerification = (req: Request) =>
    auth.resendVerification(parseBody(ResendVerification, req.body));
export const firebaseStatus = async () => auth.signInAvailability();
export const firebaseLogin = (req: Request) =>
    auth.firebaseLogin(parseBody(FirebaseLogin, req.body));

export const me = (req: Request) => auth.me(currentUser(req).id);

export const updateDisplayName = (req: Request, conn: Db) =>
    auth.updateDisplayName(conn, currentUser(req).id, parseBody(UpdateDisplayName, req.body).displayName);

export const updateUpiId = (req: Request, conn: Db) =>
    auth.updateUpiId(conn, currentUser(req).id, parseBody(UpdateUpiId, req.body).upiId);

export const confirmUpiId = (req: Request, conn: Db) => auth.confirmUpiId(conn, currentUser(req).id);
