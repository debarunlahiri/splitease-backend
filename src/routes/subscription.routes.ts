import { Router } from 'express';
import { config } from '../config';
import * as subscriptions from '../controllers/subscription.controller';
import { idempotent } from '../middlewares/idempotency';
import { route } from '../utils/http';

export const subscriptionsRouter = Router();

subscriptionsRouter.get('/plans', route(200, subscriptions.plans));
subscriptionsRouter.get('/me/entitlement', route(200, subscriptions.entitlement));
subscriptionsRouter.post('/me/purchases/verify', idempotent(200, subscriptions.verifyPurchase));

// Store webhooks exist only when that store's verification is enabled.
if (config.google.enabled) {
    subscriptionsRouter.post('/webhooks/google', route(204, subscriptions.googleWebhook));
}
if (config.apple.enabled) {
    subscriptionsRouter.post('/webhooks/apple', route(204, subscriptions.appleWebhook));
}
