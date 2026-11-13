import { checkUpiId } from '../utils/upi';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getAuth } from 'firebase-admin/auth';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { advisoryLock, Db, db, PG_UNIQUE_VIOLATION, pgErrorCode, tx } from '../database';
import {
    badCredentials,
    badRequest,
    conflict,
    forbidden,
    notFound,
    tooManyRequests,
    unavailable,
} from '../utils/errors';
import { firebaseApp, firebaseConfigured } from '../config/firebase';
import { logger } from '../utils/logger';
import { generateToken, sha256Hex } from '../utils/tokens';
import { queueMailSafely, verificationEmail, welcomeEmail } from './mail.service';

const BCRYPT_ROUNDS = 12;

const suspended = () => forbidden('This account has been suspended. Contact support for help.');

interface UserRow {
    id: string;
    email: string;
    display_name: string;
    password_hash: string;
    email_verified_at: Date | null;
    firebase_uid: string | null;
    photo_url: string | null;
    upi_id?: string | null;
    upi_verified_at?: Date | null;
    disabled_at: Date | null;
}

export interface UserView {
    id: string;
    email: string;
    displayName: string;
    photoUrl: string | null;
    /** UPI ID friends can pay (INR). */
    upiId: string | null;
    /** The owner confirmed in their UPI app that the name shown for this UPI ID is theirs. */
    upiVerified: boolean;
    /** The part after @ is not a handle we know; worth double-checking. */
    upiHandleKnown: boolean;
}

export interface AuthResponse {
    accessToken: string;
    accessTokenExpiresAt: Date;
    refreshToken: string;
    refreshTokenExpiresAt: Date;
    user: UserView;
}

interface IssuedToken {
    id: string;
    value: string;
    expiresAt: Date;
}

function userView(user: UserRow): UserView {
    return {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        photoUrl: user.photo_url,
        upiId: user.upi_id ?? null,
        upiVerified: Boolean(user.upi_id && user.upi_verified_at),
        upiHandleKnown: user.upi_id ? checkUpiId(user.upi_id).unknownHandle !== true : true,
    };
}

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

async function findByEmail(conn: Db, email: string): Promise<UserRow | undefined> {
    return (await conn.query('SELECT * FROM users WHERE email = $1', [normalizeEmail(email)]))
        .rows[0];
}

async function findById(conn: Db, id: string): Promise<UserRow | undefined> {
    return (await conn.query('SELECT * FROM users WHERE id = $1', [id])).rows[0];
}

// ------------------------------------------------------------ access tokens

function issueAccessToken(user: UserRow): { value: string; expiresAt: Date } {
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + Math.floor(config.jwt.lifetimeMs / 1000);
    const value = jwt.sign(
        {
            email: user.email,
            email_verified: user.email_verified_at !== null,
            iat: issuedAt,
            exp: expiresAt,
        },
        config.jwt.secret,
        { algorithm: 'HS256', subject: user.id },
    );
    return { value, expiresAt: new Date(expiresAt * 1000) };
}

function authResponse(user: UserRow, refreshToken: IssuedToken): AuthResponse {
    const accessToken = issueAccessToken(user);
    return {
        accessToken: accessToken.value,
        accessTokenExpiresAt: accessToken.expiresAt,
        refreshToken: refreshToken.value,
        refreshTokenExpiresAt: refreshToken.expiresAt,
        user: userView(user),
    };
}

// ----------------------------------------------------------- refresh tokens

async function issueRefreshToken(
    conn: Db,
    userId: string,
    familyId: string = randomUUID(),
): Promise<IssuedToken> {
    const id = randomUUID();
    const value = generateToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + config.refreshTokenLifetimeMs);
    await conn.query(
        `INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, userId, familyId, sha256Hex(value), expiresAt, now],
    );
    return { id, value, expiresAt };
}

async function revokeFamily(conn: Db, familyId: string): Promise<void> {
    await conn.query(
        'UPDATE refresh_tokens SET revoked_at = $1 WHERE family_id = $2 AND revoked_at IS NULL',
        [new Date(), familyId],
    );
}

// ----------------------------------------------------------- login throttle

interface Throttle {
    subjectHash: string;
    failedAttempts: number;
    windowStartedAt: Date;
    blockedUntil: Date | null;
}

/** Runs `change` on the email's throttle record in its own transaction, under a lock. */
async function withThrottle(email: string, change: (throttle: Throttle, now: Date) => void) {
    const subjectHash = sha256Hex(normalizeEmail(email));
    await tx(async (conn) => {
        await advisoryLock(conn, `login:${subjectHash}`);
        const now = new Date();
        const row = (
            await conn.query('SELECT * FROM login_throttles WHERE subject_hash = $1', [
                subjectHash,
            ])
        ).rows[0];
        const throttle: Throttle = row
            ? {
                  subjectHash,
                  failedAttempts: row.failed_attempts,
                  windowStartedAt: row.window_started_at,
                  blockedUntil: row.blocked_until,
              }
            : { subjectHash, failedAttempts: 0, windowStartedAt: now, blockedUntil: null };
        change(throttle, now);
        await conn.query(
            `INSERT INTO login_throttles (subject_hash, failed_attempts, window_started_at, blocked_until)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (subject_hash) DO UPDATE SET
                 failed_attempts = EXCLUDED.failed_attempts,
                 window_started_at = EXCLUDED.window_started_at,
                 blocked_until = EXCLUDED.blocked_until`,
            [subjectHash, throttle.failedAttempts, throttle.windowStartedAt, throttle.blockedUntil],
        );
    });
}

function reset(throttle: Throttle, now: Date): void {
    throttle.failedAttempts = 0;
    throttle.windowStartedAt = now;
    throttle.blockedUntil = null;
}

function resetExpiredWindow(throttle: Throttle, now: Date): void {
    const windowEnd = throttle.windowStartedAt.getTime() + config.loginThrottle.attemptWindowMs;
    if (windowEnd <= now.getTime()) reset(throttle, now);
}

function checkAllowed(email: string): Promise<void> {
    return withThrottle(email, (throttle, now) => {
        resetExpiredWindow(throttle, now);
        if (throttle.blockedUntil && throttle.blockedUntil.getTime() > now.getTime()) {
            throw tooManyRequests('Too many login attempts. Try again later');
        }
    });
}

function recordFailure(email: string): Promise<void> {
    return withThrottle(email, (throttle, now) => {
        resetExpiredWindow(throttle, now);
        throttle.failedAttempts++;
        if (throttle.failedAttempts >= config.loginThrottle.maximumAttempts) {
            throttle.blockedUntil = new Date(now.getTime() + config.loginThrottle.blockDurationMs);
        }
    });
}

function recordSuccess(email: string): Promise<void> {
    return withThrottle(email, reset);
}

// ------------------------------------------------------- email verification

/** Stores a fresh verification token (replacing older ones) and returns it for emailing. */
async function issueEmailVerification(conn: Db, user: UserRow): Promise<string> {
    await conn.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [user.id]);
    const token = generateToken();
    const now = new Date();
    await conn.query(
        `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
            randomUUID(),
            user.id,
            sha256Hex(token),
            new Date(now.getTime() + config.emailVerification.lifetimeMs),
            now,
        ],
    );
    return token;
}

/**
 * Queued only after the transaction commits, so no message refers to a rolled-back account.
 * The mail queue sends it and retries if the mail server is unavailable.
 */
function sendVerification(user: UserRow, token: string): Promise<void> {
    return queueMailSafely(
        verificationEmail(user.email, user.display_name, token, config.emailVerification.lifetimeMs),
        'verification',
    );
}

// ------------------------------------------------------------------ service

let dummyPasswordHash: Promise<string> | undefined;

/** Compared against when the account does not exist, so both cases take the same time. */
function timingCheckHash(): Promise<string> {
    dummyPasswordHash ??= bcrypt.hash('timing-check-only-password', BCRYPT_ROUNDS);
    return dummyPasswordHash;
}

const ACCOUNT_EXISTS = 'An account already exists for this email';

export async function register(input: {
    email: string;
    displayName: string;
    password: string;
}): Promise<void> {
    const email = normalizeEmail(input.email);
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    let created: { user: UserRow; token: string };
    try {
        created = await tx(async (conn) => {
            if (await findByEmail(conn, email)) throw conflict(ACCOUNT_EXISTS);
            const user: UserRow = (
                await conn.query(
                    `INSERT INTO users (id, email, display_name, password_hash, created_at)
                     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
                    [randomUUID(), email, input.displayName.trim(), passwordHash, new Date()],
                )
            ).rows[0];
            return { user, token: await issueEmailVerification(conn, user) };
        });
    } catch (error) {
        if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) throw conflict(ACCOUNT_EXISTS);
        throw error;
    }
    // If the email cannot be sent, the account still exists and the user can request a resend.
    await sendVerification(created.user, created.token);
}

export async function login(input: { email: string; password: string }): Promise<AuthResponse> {
    const email = normalizeEmail(input.email);
    await checkAllowed(email);
    const user = await findByEmail(db, email);
    const passwordHash = user ? user.password_hash : await timingCheckHash();
    const matches = await bcrypt.compare(input.password, passwordHash);
    if (!matches || !user) {
        await recordFailure(email);
        throw badCredentials('Invalid email or password');
    }
    await recordSuccess(email);
    if (user.disabled_at !== null) throw suspended();
    if (user.email_verified_at === null) {
        throw badCredentials('Email verification is required');
    }
    return authResponse(user, await issueRefreshToken(db, user.id));
}

/**
 * Rotates a refresh token. Presenting an already-used token revokes its whole family;
 * that revocation is committed even though the request itself is rejected.
 */
export async function refresh(input: { refreshToken: string }): Promise<AuthResponse> {
    const response = await tx(async (conn) => {
        const now = new Date();
        const current = (
            await conn.query('SELECT * FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE', [
                sha256Hex(input.refreshToken),
            ])
        ).rows[0];
        if (!current) throw badCredentials('Invalid refresh token');
        if (current.consumed_at !== null) {
            await revokeFamily(conn, current.family_id);
            return null;
        }
        if (current.revoked_at !== null || current.expires_at.getTime() <= now.getTime()) {
            throw badCredentials('Refresh token is expired or revoked');
        }
        const replacement = await issueRefreshToken(conn, current.user_id, current.family_id);
        await conn.query(
            'UPDATE refresh_tokens SET consumed_at = $1, replaced_by_id = $2 WHERE id = $3',
            [now, replacement.id, current.id],
        );
        const user = await findById(conn, current.user_id);
        if (!user) throw badCredentials('Invalid refresh token');
        if (user.disabled_at !== null) throw suspended();
        return authResponse(user, replacement);
    });
    if (response === null) throw badCredentials('Refresh token reuse detected');
    return response;
}

export async function logout(input: { refreshToken: string }): Promise<void> {
    await tx(async (conn) => {
        const token = (
            await conn.query(
                'SELECT family_id FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE',
                [sha256Hex(input.refreshToken)],
            )
        ).rows[0];
        if (token) await revokeFamily(conn, token.family_id);
    });
}

export async function verifyEmail(input: { token: string }): Promise<void> {
    const verified = await tx(async (conn) => {
        const now = new Date();
        const token = (
            await conn.query(
                'SELECT * FROM email_verification_tokens WHERE token_hash = $1 FOR UPDATE',
                [sha256Hex(input.token)],
            )
        ).rows[0];
        if (!token) throw badCredentials('Invalid email verification token');
        if (token.consumed_at !== null || token.expires_at.getTime() <= now.getTime()) {
            throw badCredentials('Email verification token is expired or already used');
        }
        const updated = await conn.query('UPDATE users SET email_verified_at = $1 WHERE id = $2', [
            now,
            token.user_id,
        ]);
        if (updated.rowCount === 0) throw badCredentials('Invalid email verification token');
        await conn.query('UPDATE email_verification_tokens SET consumed_at = $1 WHERE id = $2', [
            now,
            token.id,
        ]);
        return findById(conn, token.user_id);
    });
    if (verified) {
        void queueMailSafely(welcomeEmail(verified.email, verified.display_name), 'welcome');
    }
}

/** Silently does nothing for unknown or already-verified emails, so accounts cannot be probed. */
export async function resendVerification(input: { email: string }): Promise<void> {
    const issued = await tx(async (conn) => {
        const user = await findByEmail(conn, input.email);
        if (!user || user.email_verified_at !== null) return null;
        return { user, token: await issueEmailVerification(conn, user) };
    });
    if (issued) await sendVerification(issued.user, issued.token);
}

export async function me(userId: string): Promise<UserView> {
    const user = await findById(db, userId);
    if (!user) throw notFound('User not found');
    return userView(user);
}

export async function updateDisplayName(conn: Db, userId: string, name: string): Promise<UserView> {
    const { rows } = await conn.query(
        'UPDATE users SET display_name = $1 WHERE id = $2 RETURNING *',
        [name, userId],
    );
    if (!rows[0]) throw notFound('User not found');
    return userView(rows[0]);
}

export async function updateUpiId(conn: Db, userId: string, upiId: string | null): Promise<UserView> {
    // A new UPI ID starts unverified.
    const { rows } = await conn.query(
        'UPDATE users SET upi_id = $1::varchar, upi_verified_at = CASE WHEN upi_id IS NOT DISTINCT FROM $1::varchar THEN upi_verified_at ELSE NULL END WHERE id = $2 RETURNING *',
        [upiId, userId],
    );
    if (!rows[0]) throw notFound('User not found');
    return userView(rows[0]);
}

/**
 * The owner says the name their UPI app showed for this UPI ID is theirs. This is a self-confirmation,
 * not a check with the bank: it proves the ID reaches the person it should, because they saw the name.
 */
export async function confirmUpiId(conn: Db, userId: string): Promise<UserView> {
    const { rows } = await conn.query(
        'UPDATE users SET upi_verified_at = now() WHERE id = $1 AND upi_id IS NOT NULL RETURNING *',
        [userId],
    );
    if (!rows[0]) throw badRequest('Add a UPI ID first');
    return userView(rows[0]);
}

// ----------------------------------------------------- Firebase Google login

const SIGN_IN_UNAVAILABLE = 'Sign-in is temporarily unavailable. Please try again later.';

function firebaseAuth() {
    if (!firebaseConfigured()) {
        logger.error('Firebase Google sign-in is unavailable: FIREBASE_PROJECT_ID is not configured');
        throw unavailable(SIGN_IN_UNAVAILABLE);
    }
    try {
        return getAuth(firebaseApp());
    } catch (error) {
        logger.error(
            'Firebase Admin credentials are unavailable. Configure GOOGLE_APPLICATION_CREDENTIALS' +
                ' with a server service-account file.',
            error,
        );
        throw unavailable(SIGN_IN_UNAVAILABLE);
    }
}

/** Lets the client check that Google sign-in is configured before starting it. */
export function signInAvailability(): { available: boolean } {
    firebaseAuth();
    return { available: true };
}

/** Provider photos are kept only when they are plain https URLs. */
function safePhotoUrl(value: unknown): string | null {
    if (typeof value !== 'string' || value.trim() === '' || value.length > 2048) return null;
    try {
        const url = new URL(value.trim());
        if (url.protocol === 'https:' && url.hostname && !url.username && !url.password) {
            return url.toString();
        }
    } catch {
        // Invalid or missing provider photos must not prevent authentication.
    }
    return null;
}

export async function firebaseLogin(input: { idToken: string }): Promise<AuthResponse> {
    const auth = firebaseAuth();
    let token;
    try {
        token = await auth.verifyIdToken(input.idToken, true);
    } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        if (typeof code === 'string' && code.startsWith('auth/') && code !== 'auth/internal-error') {
            throw badCredentials('Invalid Firebase credential');
        }
        logger.error('Firebase ID token verification is unavailable', error);
        throw unavailable(SIGN_IN_UNAVAILABLE);
    }
    const email = token.email;
    if (
        token.firebase?.sign_in_provider !== 'google.com' ||
        token.email_verified !== true ||
        !email
    ) {
        throw badCredentials('A verified Google account is required');
    }
    const name = typeof token.name === 'string' && token.name.trim() ? token.name : 'SplitEase member';
    let newAccount = false as boolean;
    const response = await tx(async (conn) => {
        newAccount = false;
        let user: UserRow | undefined = (
            await conn.query('SELECT * FROM users WHERE firebase_uid = $1', [token.uid])
        ).rows[0];
        if (!user) {
            if (await findByEmail(conn, email)) {
                throw conflict(
                    'An account already uses this email. Google sign-in requires explicit' +
                        ' account linking.',
                );
            }
            const now = new Date();
            user = (
                await conn.query(
                    `INSERT INTO users (id, email, display_name, password_hash, created_at,
                                        email_verified_at, firebase_uid)
                     VALUES ($1, $2, $3, $4, $5, $5, $6) RETURNING *`,
                    [
                        randomUUID(),
                        normalizeEmail(email),
                        name.slice(0, 100).trim(),
                        // Google accounts never sign in with a password.
                        await bcrypt.hash(randomUUID(), BCRYPT_ROUNDS),
                        now,
                        token.uid,
                    ],
                )
            ).rows[0] as UserRow;
            newAccount = true;
        }
        if (user.disabled_at) throw suspended();
        user.photo_url = safePhotoUrl(token.picture);
        await conn.query('UPDATE users SET photo_url = $1 WHERE id = $2', [user.photo_url, user.id]);
        return authResponse(user, await issueRefreshToken(conn, user.id));
    });
    if (newAccount) {
        void queueMailSafely(
            welcomeEmail(response.user.email, response.user.displayName),
            'welcome',
        );
    }
    return response;
}
