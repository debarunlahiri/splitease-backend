import { createHash } from 'node:crypto';
import fs from 'node:fs';
import {
    Environment,
    SignedDataVerifier,
    VerificationException,
} from '@apple/app-store-server-library';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';
import { config } from '../config';
import { badCredentials, badRequest } from '../utils/errors';
import { isUuid } from '../utils/http';
import { sha256Hex } from '../utils/tokens';

export type StoreProvider = 'GOOGLE_PLAY' | 'APPLE_APP_STORE';

/** What a store confirmed about a purchase. Client claims alone never grant an entitlement. */
export interface VerifiedPurchase {
    provider: StoreProvider;
    /** Stable identifier of the store subscription; never the raw purchase token. */
    providerReference: string;
    productId: string;
    userId: string;
    purchasedAt: Date;
    expiresAt: Date;
    active: boolean;
}

export interface StoreNotification {
    notificationId: string;
    purchase: VerifiedPurchase;
}

function parseDate(value: unknown, problem: string): Date {
    const date = typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) throw badRequest(problem);
    return date;
}

// -------------------------------------------------------------- Google Play

const ANDROID_PUBLISHER_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const ACTIVE_GOOGLE_STATES = new Set([
    'SUBSCRIPTION_STATE_ACTIVE',
    'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
    'SUBSCRIPTION_STATE_CANCELED',
]);

let googleAuth: GoogleAuth | undefined;

/** Only this hash of a Google purchase token is stored. */
export function googleTokenReference(purchaseToken: string): string {
    return sha256Hex(purchaseToken);
}

/** Reads the purchase from the Android Publisher subscriptions v2 API. */
async function fetchGooglePurchase(purchaseToken: string): Promise<any> {
    googleAuth ??= new GoogleAuth({ scopes: [ANDROID_PUBLISHER_SCOPE] });
    const accessToken = await googleAuth.getAccessToken();
    if (!accessToken) throw new Error('Could not obtain Google Play API credentials');
    const response = await fetch(
        'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/' +
            `${encodeURIComponent(config.google.packageName)}/purchases/subscriptionsv2/tokens/` +
            encodeURIComponent(purchaseToken),
        { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000) },
    );
    if (response.status === 400 || response.status === 404 || response.status === 410) {
        throw badRequest('Google Play does not recognize this purchase');
    }
    if (!response.ok) {
        throw new Error(`Google Play purchase lookup failed with HTTP ${response.status}`);
    }
    const body: unknown = await response.json();
    if (body === null || typeof body !== 'object') {
        throw badRequest('Google Play returned an empty purchase response');
    }
    return body;
}

function googleUserId(purchase: any): string {
    const accountId = purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId;
    if (!isUuid(accountId)) throw badRequest('Google Play purchase has no valid user binding');
    return accountId.toLowerCase();
}

function googleVerifiedPurchase(
    userId: string,
    expectedProductId: string,
    purchaseToken: string,
    purchase: any,
): VerifiedPurchase {
    const lineItems: any[] = Array.isArray(purchase.lineItems) ? purchase.lineItems : [];
    const lineItem = lineItems.find((item) => item?.productId === expectedProductId);
    if (!lineItem) throw badRequest('Google Play purchase does not match the requested plan');
    const verifiedUserId = googleUserId(purchase);
    if (userId !== verifiedUserId) throw badRequest('Google Play purchase belongs to another user');
    return {
        provider: 'GOOGLE_PLAY',
        providerReference: googleTokenReference(purchaseToken),
        productId: expectedProductId,
        userId: verifiedUserId,
        purchasedAt: parseDate(purchase.startTime, 'Google Play purchase has no start time'),
        expiresAt: parseDate(lineItem.expiryTime, 'Google Play purchase has no expiry time'),
        active: ACTIVE_GOOGLE_STATES.has(purchase.subscriptionState),
    };
}

/** Confirms a purchase the app reports for `userId` and the plan's Google product. */
export async function verifyGooglePurchase(
    userId: string,
    googleProductId: string | null,
    purchaseToken: string,
): Promise<VerifiedPurchase> {
    if (!googleProductId) throw new Error('The selected plan has no Google Play product id');
    return googleVerifiedPurchase(
        userId,
        googleProductId,
        purchaseToken,
        await fetchGooglePurchase(purchaseToken),
    );
}

/** Looks up the purchase a Real-time Developer Notification refers to. */
export async function verifyGoogleNotification(purchaseToken: string): Promise<VerifiedPurchase> {
    const purchase = await fetchGooglePurchase(purchaseToken);
    if (!Array.isArray(purchase.lineItems) || purchase.lineItems.length !== 1) {
        throw badRequest('Google Play notification requires one subscription product');
    }
    return googleVerifiedPurchase(
        googleUserId(purchase),
        String(purchase.lineItems[0]?.productId ?? ''),
        purchaseToken,
        purchase,
    );
}

const googleIdTokens = new OAuth2Client();

/** Checks that a Pub/Sub push request was signed by Google for our service account. */
export async function authenticateGooglePush(authorization: string | undefined): Promise<void> {
    if (!authorization || !authorization.startsWith('Bearer ')) {
        throw badCredentials('Google push authentication is required');
    }
    let payload;
    try {
        const ticket = await googleIdTokens.verifyIdToken({
            idToken: authorization.slice(7),
            audience: config.google.pushAudience,
        });
        payload = ticket.getPayload();
    } catch {
        throw badCredentials('Invalid Google push token');
    }
    if (
        !payload ||
        payload.email_verified !== true ||
        payload.email !== config.google.pushServiceAccountEmail
    ) {
        throw badCredentials('Invalid Google push identity');
    }
}

/** Deterministic id for a Pub/Sub message (name-based UUID, version 3), used for deduplication. */
export function googleNotificationId(subscriptionName: string, messageId: string): string {
    const hash = createHash('md5')
        .update(`GOOGLE_PLAY:${subscriptionName}:${messageId}`, 'utf8')
        .digest();
    hash[6] = (hash[6] & 0x0f) | 0x30;
    hash[8] = (hash[8] & 0x3f) | 0x80;
    const hex = hash.toString('hex');
    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20, 32),
    ].join('-');
}

// ---------------------------------------------------------- Apple App Store

type AppleTransaction = Awaited<ReturnType<SignedDataVerifier['verifyAndDecodeTransaction']>>;

let appleVerifier: SignedDataVerifier | undefined;

function apple(): SignedDataVerifier {
    if (!appleVerifier) {
        const name = config.apple.environment.toUpperCase() as keyof typeof Environment;
        const environment = Environment[name];
        if (!environment) {
            throw new Error(`Unknown APPLE_STORE_ENVIRONMENT: ${config.apple.environment}`);
        }
        const rootCertificates = config.apple.rootCertificatePaths.map((path) =>
            fs.readFileSync(path),
        );
        appleVerifier = new SignedDataVerifier(
            rootCertificates,
            true,
            environment,
            config.apple.bundleId,
            environment === Environment.PRODUCTION ? config.apple.appAppleId : undefined,
        );
    }
    return appleVerifier;
}

function appleVerifiedPurchase(
    expectedUserId: string,
    expectedProductId: string,
    transaction: AppleTransaction,
): VerifiedPurchase {
    if (!transaction.productId || transaction.productId !== expectedProductId) {
        throw badRequest('Apple transaction does not match the requested plan');
    }
    if (expectedUserId !== (transaction.appAccountToken ?? '').toLowerCase()) {
        throw badRequest('Apple transaction belongs to another user');
    }
    if (!transaction.originalTransactionId) {
        throw badRequest('Apple transaction has no original transaction id');
    }
    const expiresAt = parseDate(transaction.expiresDate, 'Apple transaction has no expiry date');
    return {
        provider: 'APPLE_APP_STORE',
        providerReference: transaction.originalTransactionId,
        productId: transaction.productId,
        userId: expectedUserId,
        purchasedAt: parseDate(transaction.purchaseDate, 'Apple transaction has no purchase date'),
        expiresAt,
        active:
            (transaction.revocationDate === undefined || transaction.revocationDate === null) &&
            expiresAt.getTime() > Date.now(),
    };
}

/** Verifies a StoreKit signed transaction for `userId` and the plan's Apple product. */
export async function verifyApplePurchase(
    userId: string,
    appleProductId: string | null,
    signedTransaction: string,
): Promise<VerifiedPurchase> {
    if (!appleProductId) throw new Error('The selected plan has no Apple product id');
    try {
        const transaction = await apple().verifyAndDecodeTransaction(signedTransaction);
        return appleVerifiedPurchase(userId, appleProductId, transaction);
    } catch (error) {
        if (error instanceof VerificationException) {
            throw badRequest('Apple transaction signature verification failed');
        }
        throw error;
    }
}

/** Verifies an App Store Server Notification V2 and the transaction inside it. */
export async function verifyAppleNotification(signedPayload: string): Promise<StoreNotification> {
    try {
        const notification = await apple().verifyAndDecodeNotification(signedPayload);
        const signedTransaction = notification.data?.signedTransactionInfo;
        if (!signedTransaction) {
            throw badRequest('Apple notification has no transaction information');
        }
        const transaction = await apple().verifyAndDecodeTransaction(signedTransaction);
        const userId = transaction.appAccountToken;
        if (!isUuid(userId)) throw badRequest('Apple transaction has no app account token');
        if (!isUuid(notification.notificationUUID)) {
            throw badRequest('Apple notification has no notification id');
        }
        return {
            notificationId: notification.notificationUUID.toLowerCase(),
            purchase: appleVerifiedPurchase(
                userId.toLowerCase(),
                transaction.productId ?? '',
                transaction,
            ),
        };
    } catch (error) {
        if (error instanceof VerificationException) {
            throw badRequest('Apple notification signature verification failed');
        }
        throw error;
    }
}
