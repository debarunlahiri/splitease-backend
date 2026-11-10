import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { advisoryLock, Db } from '../database';
import { badRequest, conflict, notFound, unavailable } from '../utils/errors';
import { toJsonNumber } from '../utils/money';
import {
    googleNotificationId,
    googleTokenReference,
    StoreProvider,
    VerifiedPurchase,
    verifyAppleNotification,
    verifyApplePurchase,
    verifyGoogleNotification,
    verifyGooglePurchase,
} from './store-verification.service';

export interface PlanView {
    code: string;
    name: string;
    price: number;
    currency: string;
    durationDays: number;
    removesAds: boolean;
}

export interface Entitlement {
    adsEnabled: boolean;
    planCode: string;
    expiresAt: Date | null;
}

const FREE: Entitlement = { adsEnabled: true, planCode: 'FREE', expiresAt: null };

export async function plans(db: Db): Promise<PlanView[]> {
    const rows = (await db.query('SELECT * FROM plans WHERE active ORDER BY price ASC')).rows;
    return rows.map((plan) => ({
        code: plan.code,
        name: plan.name,
        price: toJsonNumber(plan.price),
        currency: plan.currency,
        durationDays: plan.duration_days,
        removesAds: plan.removes_ads,
    }));
}

/** Ads stay on unless an active, unexpired plan removes them. */
export async function entitlement(db: Db, userId: string): Promise<Entitlement> {
    const row = (
        await db.query(
            `SELECT s.expires_at, p.code, p.removes_ads
             FROM subscriptions s JOIN plans p ON p.id = s.plan_id
             WHERE s.user_id = $1 AND s.status = 'ACTIVE' AND s.expires_at > $2
             ORDER BY s.expires_at DESC LIMIT 1`,
            [userId, new Date()],
        )
    ).rows[0];
    return row
        ? { adsEnabled: !row.removes_ads, planCode: row.code, expiresAt: row.expires_at }
        : FREE;
}

/** Serializes work on one store purchase or notification across requests and instances. */
function lock(db: Db, key: string): Promise<void> {
    return advisoryLock(db, key);
}

async function findSubscription(db: Db, purchase: VerifiedPurchase): Promise<any> {
    return (
        await db.query(
            'SELECT * FROM subscriptions WHERE provider = $1 AND provider_reference = $2 FOR UPDATE',
            [purchase.provider, purchase.providerReference],
        )
    ).rows[0];
}

async function createSubscription(db: Db, planId: string, purchase: VerifiedPurchase): Promise<void> {
    await db.query(
        `INSERT INTO subscriptions
             (id, user_id, plan_id, status, starts_at, expires_at, provider, provider_reference)
         VALUES ($1, $2, $3, 'ACTIVE', $4, $5, $6, $7)`,
        [
            randomUUID(),
            purchase.userId,
            planId,
            purchase.purchasedAt,
            purchase.expiresAt,
            purchase.provider,
            purchase.providerReference,
        ],
    );
}

async function applyVerification(
    db: Db,
    subscriptionId: string,
    purchase: VerifiedPurchase,
    active: boolean,
): Promise<void> {
    await db.query(
        'UPDATE subscriptions SET starts_at = $1, expires_at = $2, status = $3 WHERE id = $4',
        [purchase.purchasedAt, purchase.expiresAt, active ? 'ACTIVE' : 'INACTIVE', subscriptionId],
    );
}

function providerEnabled(provider: StoreProvider): boolean {
    return provider === 'GOOGLE_PLAY' ? config.google.enabled : config.apple.enabled;
}

/** Grants the entitlement only after the store itself confirms the purchase. */
export async function verifyPurchase(
    db: Db,
    userId: string,
    input: { provider: StoreProvider; planCode: string; purchaseToken: string },
): Promise<Entitlement> {
    const plan = (await db.query('SELECT * FROM plans WHERE code = $1 AND active', [input.planCode]))
        .rows[0];
    if (!plan) throw notFound('Subscription plan not found');
    if (!providerEnabled(input.provider)) {
        throw unavailable(`Purchase verification is not configured for ${input.provider}`);
    }
    let verified: VerifiedPurchase;
    if (input.provider === 'GOOGLE_PLAY') {
        await lock(db, `GOOGLE_PLAY:${googleTokenReference(input.purchaseToken)}`);
        verified = await verifyGooglePurchase(userId, plan.google_product_id, input.purchaseToken);
    } else {
        verified = await verifyApplePurchase(userId, plan.apple_product_id, input.purchaseToken);
    }
    if (!verified.active || verified.expiresAt.getTime() <= Date.now()) {
        throw badRequest('The store purchase is not active');
    }
    await lock(db, `${verified.provider}:${verified.providerReference}`);
    const existing = await findSubscription(db, verified);
    let planOfSubscription = plan;
    if (existing) {
        if (existing.user_id !== userId) {
            throw conflict('This store transaction is already assigned to another account');
        }
        await applyVerification(db, existing.id, verified, verified.active);
        planOfSubscription = (await db.query('SELECT * FROM plans WHERE id = $1', [existing.plan_id]))
            .rows[0];
    } else {
        await createSubscription(db, plan.id, verified);
    }
    return {
        adsEnabled: !planOfSubscription.removes_ads,
        planCode: planOfSubscription.code,
        expiresAt: verified.expiresAt,
    };
}

// ---------------------------------------------------------------- webhooks

async function alreadyProcessed(db: Db, notificationId: string): Promise<boolean> {
    await lock(db, `notification:${notificationId}`);
    const row = (
        await db.query(
            'SELECT 1 FROM processed_store_notifications WHERE notification_id = $1',
            [notificationId],
        )
    ).rows[0];
    return Boolean(row);
}

async function markProcessed(db: Db, notificationId: string, provider: StoreProvider): Promise<void> {
    await db.query(
        `INSERT INTO processed_store_notifications (notification_id, provider, processed_at)
         VALUES ($1, $2, $3)`,
        [notificationId, provider, new Date()],
    );
}

/** Activates, renews, expires or revokes the subscription a store notification is about. */
async function applyNotification(
    db: Db,
    purchase: VerifiedPurchase,
    planId: string,
    active: boolean,
    assignedElsewhere: string,
): Promise<void> {
    const existing = await findSubscription(db, purchase);
    if (existing) {
        if (existing.user_id !== purchase.userId) throw conflict(assignedElsewhere);
        await applyVerification(db, existing.id, purchase, active);
    } else if (active) {
        await createSubscription(db, planId, purchase);
    }
}

/** Google Play Real-time Developer Notification, delivered by Pub/Sub push. */
export async function processGoogleNotification(
    db: Db,
    subscriptionName: string,
    messageId: string,
    data: string,
): Promise<void> {
    if (subscriptionName !== config.google.pushSubscription) {
        throw badRequest('Unexpected Google push subscription');
    }
    const notificationId = googleNotificationId(subscriptionName, messageId);
    if (await alreadyProcessed(db, notificationId)) return;

    let payload: any;
    try {
        payload = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
    } catch {
        throw badRequest('Invalid Google notification data');
    }
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        throw badRequest('Invalid Google notification data');
    }
    if (payload.packageName !== config.google.packageName) {
        throw badRequest('Unexpected Google Play package');
    }
    if ('testNotification' in payload) {
        await markProcessed(db, notificationId, 'GOOGLE_PLAY');
        return;
    }
    const token =
        payload.subscriptionNotification?.purchaseToken ||
        payload.voidedPurchaseNotification?.purchaseToken;
    if (typeof token !== 'string' || token.trim() === '') {
        throw badRequest('Google notification has no subscription purchase token');
    }
    await lock(db, `GOOGLE_PLAY:${googleTokenReference(token)}`);
    const purchase = await verifyGoogleNotification(token);
    const plan = (
        await db.query('SELECT id FROM plans WHERE google_product_id = $1 AND active', [
            purchase.productId,
        ])
    ).rows[0];
    if (!plan) throw notFound('Google product is not mapped to an active plan');
    await applyNotification(
        db,
        purchase,
        plan.id,
        purchase.active && purchase.expiresAt.getTime() > Date.now(),
        'Google subscription is assigned to another account',
    );
    await markProcessed(db, notificationId, 'GOOGLE_PLAY');
}

/** App Store Server Notification V2. */
export async function processAppleNotification(db: Db, signedPayload: string): Promise<void> {
    const notification = await verifyAppleNotification(signedPayload);
    if (await alreadyProcessed(db, notification.notificationId)) return;
    const purchase = notification.purchase;
    await lock(db, `${purchase.provider}:${purchase.providerReference}`);
    const plan = (
        await db.query('SELECT id FROM plans WHERE apple_product_id = $1 AND active', [
            purchase.productId,
        ])
    ).rows[0];
    if (!plan) throw notFound('Apple product is not mapped to an active plan');
    await applyNotification(
        db,
        purchase,
        plan.id,
        purchase.active,
        'Apple subscription is assigned to another account',
    );
    await markProcessed(db, notification.notificationId, purchase.provider);
}
