import 'dotenv/config';

function str(name: string, fallback: string): string {
    const value = process.env[name];
    return value === undefined || value === '' ? fallback : value;
}

function int(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
    return value;
}

function bool(name: string, fallback: boolean): boolean {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    return raw.trim().toLowerCase() === 'true';
}

/** Parses ISO-8601 durations such as P30D, PT24H, PT15M or PT5S into milliseconds. */
export function parseDuration(value: string): number {
    const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(
        value.trim(),
    );
    if (!match || value.trim().length < 3) {
        throw new Error(`Invalid ISO-8601 duration: ${value}`);
    }
    const [, days, hours, minutes, seconds] = match;
    return (
        (Number(days ?? 0) * 86_400 +
            Number(hours ?? 0) * 3_600 +
            Number(minutes ?? 0) * 60 +
            Number(seconds ?? 0)) *
        1000
    );
}

function duration(name: string, fallback: string): number {
    try {
        return parseDuration(str(name, fallback));
    } catch {
        throw new Error(`${name} must be an ISO-8601 duration such as ${fallback}`);
    }
}

export const config = {
    port: int('PORT', 9890),
    database: {
        url: str('DATABASE_URL', 'postgres://splitease:change-me@127.0.0.1:15433/splitease'),
        poolMax: int('DB_POOL_MAX_SIZE', 10),
        autoMigrate: bool('AUTO_MIGRATE', true),
    },
    jwt: {
        secret: str('JWT_SECRET', 'replace-with-at-least-32-characters'),
        lifetimeMs: duration('JWT_LIFETIME', 'PT1H'),
    },
    admin: {
        // Admin tokens are signed with their own secret so they can never act as app users.
        secret: str('ADMIN_JWT_SECRET', ''),
        lifetimeMs: duration('ADMIN_JWT_LIFETIME', 'PT8H'),
    },
    refreshTokenLifetimeMs: duration('REFRESH_TOKEN_LIFETIME', 'P30D'),
    emailVerification: {
        lifetimeMs: duration('EMAIL_VERIFICATION_LIFETIME', 'PT24H'),
    },
    loginThrottle: {
        maximumAttempts: int('LOGIN_MAXIMUM_ATTEMPTS', 5),
        attemptWindowMs: duration('LOGIN_ATTEMPT_WINDOW', 'PT15M'),
        blockDurationMs: duration('LOGIN_BLOCK_DURATION', 'PT15M'),
    },
    groups: {
        invitationLifetimeMs: duration('GROUP_INVITATION_LIFETIME', 'P7D'),
        inviteLinkLifetimeMs: 7 * 86_400_000,
    },
    outbox: {
        publishDelayMs: duration('OUTBOX_PUBLISH_DELAY', 'PT2S'),
    },
    push: {
        enabled: bool('PUSH_DELIVERY_ENABLED', false),
        dispatchDelayMs: duration('PUSH_DISPATCH_DELAY', 'PT5S'),
    },
    firebase: {
        projectId: str('FIREBASE_PROJECT_ID', '').trim(),
    },
    // Allowed CORS origins, comma separated. The first one is also used for web links.
    appUrls: str('APP_URL', 'http://localhost:3000')
        .split(',')
        .map((value) => value.trim().replace(/\/+$/, ''))
        .filter((value) => value.length > 0),
    // When set (e.g. https://splitease.lambrk.com/join), GET /join redirects there so shared
    // invite links open the website, which sends mobile visitors into the app.
    inviteLandingUrl: str('INVITE_LANDING_URL', '').trim(),
    mail: {
        host: str('SMTP_HOST', '').trim(),
        port: int('SMTP_PORT', 465),
        // true = TLS from the first byte (port 465); false = STARTTLS (port 587).
        secure: bool('SMTP_SECURE', true),
        user: str('SMTP_USER', '').trim(),
        password: str('SMTP_PASSWORD', ''),
        fromName: str('MAIL_FROM_NAME', 'SplitEase').trim(),
        // Defaults to the login; set it when the mailbox login is not the sender address.
        fromAddress: str('MAIL_FROM_ADDRESS', '').trim(),
        // How often the queue is checked for emails that are due (first try or retry).
        dispatchDelayMs: duration('MAIL_DISPATCH_DELAY', 'PT5S'),
        // Tries per email before giving up. Delays between tries: 30s, 1m, 2m, 4m ... up to 1h.
        maxAttempts: Math.max(1, int('MAIL_MAX_ATTEMPTS', 8)),
    },
    google: {
        enabled: bool('GOOGLE_PLAY_VERIFICATION_ENABLED', false),
        packageName: str('GOOGLE_PLAY_PACKAGE_NAME', 'com.splitease.app'),
        pushAudience: str('GOOGLE_PLAY_PUSH_AUDIENCE', '').trim(),
        pushServiceAccountEmail: str('GOOGLE_PLAY_PUSH_SERVICE_ACCOUNT_EMAIL', '').trim(),
        pushSubscription: str('GOOGLE_PLAY_PUSH_SUBSCRIPTION', '').trim(),
    },
    apple: {
        enabled: bool('APPLE_STORE_VERIFICATION_ENABLED', false),
        bundleId: str('APPLE_BUNDLE_ID', 'com.splitease.app'),
        appAppleId: int('APPLE_APP_ID', 0),
        environment: str('APPLE_STORE_ENVIRONMENT', 'PRODUCTION'),
        rootCertificatePaths: str('APPLE_ROOT_CERTIFICATE_PATHS', '')
            .split(',')
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
    },
    apiLog: {
        enabled: bool('API_LOG_ENABLED', true),
        bodyLimit: Math.max(0, Math.min(int('API_LOG_BODY_LIMIT', 16_384), 65_536)),
    },
};

/** Fails fast on configuration that would only break later, at request time. */
export function validateConfig(): void {
    if (Buffer.byteLength(config.jwt.secret, 'utf8') < 32) {
        throw new Error('JWT_SECRET must be at least 32 characters');
    }
    if (config.admin.secret && Buffer.byteLength(config.admin.secret, 'utf8') < 32) {
        throw new Error('ADMIN_JWT_SECRET must be at least 32 characters');
    }
    if (config.google.enabled) {
        if (!config.google.pushAudience || !config.google.pushServiceAccountEmail) {
            throw new Error('Google push audience and service account email are required');
        }
        if (!config.google.pushSubscription) {
            throw new Error('Google push subscription is required');
        }
    }
    if (config.apple.enabled && config.apple.rootCertificatePaths.length === 0) {
        throw new Error('Apple root certificates are required when Apple verification is enabled');
    }
    const { host, user, password } = config.mail;
    if ((host || user || password) && !(host && user && password)) {
        throw new Error('SMTP_HOST, SMTP_USER and SMTP_PASSWORD must all be set to send email');
    }
    if (config.appUrls.length === 0) {
        throw new Error('APP_URL must contain at least one URL');
    }
    if (config.push.enabled && !config.firebase.projectId) {
        throw new Error('Firebase project is required for push delivery');
    }
}
