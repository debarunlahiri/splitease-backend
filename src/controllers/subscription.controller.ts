import type { Request } from 'express';
import { db, Db, tx } from '../database';
import * as subscriptions from '../services/subscription.service';
import { authenticateGooglePush } from '../services/store-verification.service';
import { currentUser } from '../utils/http';
import { parseBody } from '../validators/common';
import {
    AppleNotification,
    GooglePush,
    VerifyPurchase,
} from '../validators/subscription.validator';

export const plans = async () => subscriptions.plans(db);

export const entitlement = (req: Request) => subscriptions.entitlement(db, currentUser(req).id);

export const verifyPurchase = (req: Request, conn: Db) =>
    subscriptions.verifyPurchase(conn, currentUser(req).id, parseBody(VerifyPurchase, req.body));

// Store webhooks are public routes: each one authenticates the store itself.

export const googleWebhook = async (req: Request) => {
    const envelope = parseBody(GooglePush, req.body);
    await authenticateGooglePush(req.header('authorization'));
    await tx((conn) =>
        subscriptions.processGoogleNotification(
            conn,
            envelope.subscription,
            envelope.message.messageId,
            envelope.message.data,
        ),
    );
};

export const appleWebhook = async (req: Request) => {
    const { signedPayload } = parseBody(AppleNotification, req.body);
    await tx((conn) => subscriptions.processAppleNotification(conn, signedPayload));
};
