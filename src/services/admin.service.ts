import { describeChanges, parseSnapshot, snapshotUserIds, summarize } from './expense-history';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { db } from '../database';
import {
    badCredentials,
    badRequest,
    conflict,
    notFound,
    tooManyRequests,
    unavailable,
} from '../utils/errors';
import { PageRequest, pageResponse } from '../utils/http';

export interface AdminView {
    id: string;
    email: string;
    displayName: string;
}

const BCRYPT_ROUNDS = 12;

// ------------------------------------------------------------------- auth

export function adminEnabled(): boolean {
    return config.admin.secret.length >= 32;
}

export function requireAdminEnabled(): void {
    if (!adminEnabled()) throw unavailable('The admin API is not configured');
}

function view(row: { id: string; email: string; display_name: string }): AdminView {
    return { id: row.id, email: row.email, displayName: row.display_name };
}

// Failed sign-ins per client + email, kept in memory (admin traffic is tiny).
const failures = new Map<string, { count: number; first: number }>();
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60_000;

function throttleKey(ip: string, email: string): string {
    return `${ip}|${email}`;
}

function assertNotBlocked(key: string): void {
    const entry = failures.get(key);
    if (!entry) return;
    if (Date.now() - entry.first > FAILURE_WINDOW_MS) {
        failures.delete(key);
        return;
    }
    if (entry.count >= MAX_FAILURES) {
        throw tooManyRequests('Too many failed sign-in attempts. Try again later.');
    }
}

function recordFailure(key: string): void {
    const entry = failures.get(key);
    if (!entry || Date.now() - entry.first > FAILURE_WINDOW_MS) {
        failures.set(key, { count: 1, first: Date.now() });
    } else {
        entry.count++;
    }
}

let dummyHash: Promise<string> | undefined;

export async function login(input: { email: string; password: string }, ip: string) {
    requireAdminEnabled();
    const email = input.email.trim().toLowerCase();
    const key = throttleKey(ip, email);
    assertNotBlocked(key);

    const row = (await db.query('SELECT * FROM admin_users WHERE email = $1', [email])).rows[0];
    dummyHash ??= bcrypt.hash('timing-check-only-password', BCRYPT_ROUNDS);
    const matches = await bcrypt.compare(input.password, row ? row.password_hash : await dummyHash);
    if (!row || !matches || row.disabled_at) {
        recordFailure(key);
        throw badCredentials('Invalid email or password');
    }
    failures.delete(key);
    await db.query('UPDATE admin_users SET last_login_at = $1 WHERE id = $2', [new Date(), row.id]);

    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + Math.floor(config.admin.lifetimeMs / 1000);
    const accessToken = jwt.sign({ typ: 'admin', iat: issuedAt, exp: expiresAt }, config.admin.secret, {
        algorithm: 'HS256',
        subject: row.id,
    });
    return { accessToken, expiresAt: new Date(expiresAt * 1000), admin: view(row) };
}

/** Resolves a bearer token to an enabled admin, or undefined. */
export async function authenticateAdmin(token: string): Promise<AdminView | undefined> {
    if (!adminEnabled()) return undefined;
    try {
        const claims = jwt.verify(token, config.admin.secret, { algorithms: ['HS256'] });
        if (typeof claims === 'string' || claims.typ !== 'admin' || typeof claims.sub !== 'string') {
            return undefined;
        }
        const row = (
            await db.query('SELECT * FROM admin_users WHERE id = $1 AND disabled_at IS NULL', [
                claims.sub,
            ])
        ).rows[0];
        return row ? view(row) : undefined;
    } catch {
        return undefined;
    }
}

export async function createAdmin(email: string, displayName: string, password: string) {
    const id = randomUUID();
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await db.query(
        'INSERT INTO admin_users (id, email, display_name, password_hash) VALUES ($1, $2, $3, $4)',
        [id, email.trim().toLowerCase(), displayName.trim(), hash],
    );
    return id;
}

// --------------------------------------------------------------- overview

const num = (value: unknown): number => Number(value ?? 0);

export async function overview() {
    const counts = (
        await db.query(`
        SELECT
            (SELECT COUNT(*) FROM users) AS users,
            (SELECT COUNT(*) FROM users WHERE email_verified_at IS NOT NULL) AS verified_users,
            (SELECT COUNT(*) FROM users WHERE created_at > now() - interval '7 days') AS new_users_7d,
            (SELECT COUNT(*) FROM users WHERE created_at > now() - interval '30 days') AS new_users_30d,
            (SELECT COUNT(*) FROM expense_groups) AS groups,
            (SELECT COUNT(*) FROM expenses WHERE deleted_at IS NULL) AS expenses,
            (SELECT COUNT(*) FROM settlements) AS settlements,
            (SELECT COUNT(*) FROM subscriptions WHERE status = 'ACTIVE' AND expires_at > now()) AS active_subscriptions,
            (SELECT COUNT(*) FROM ios_update_subscriptions) AS ios_waitlist,
            (SELECT COUNT(*) FROM email_queue WHERE sent_at IS NULL AND failed_at IS NULL) AS emails_pending,
            (SELECT COUNT(*) FROM email_queue WHERE failed_at IS NOT NULL) AS emails_failed,
            (SELECT COUNT(*) FROM expense_payment_claims WHERE status = 'PENDING') AS claims_pending,
            (SELECT COUNT(*) FROM expense_payment_claims WHERE status = 'REJECTED' AND created_at > now() - interval '30 days') AS claims_rejected_30d,
            (SELECT COUNT(*) FROM pay_links WHERE expires_at > now()) AS pay_links_active,
            (SELECT COUNT(*) FROM users WHERE upi_id IS NOT NULL) AS users_with_upi,
            (SELECT COUNT(*) FROM users WHERE upi_verified_at IS NOT NULL AND upi_id IS NOT NULL) AS users_upi_verified,
            (SELECT COUNT(*) FROM users WHERE is_contact) AS contact_members,
            (SELECT COUNT(*) FROM expense_templates) AS templates,
            (SELECT COUNT(*) FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
                WHERE e.deleted_at IS NULL AND s.user_id <> e.paid_by AND s.amount > s.paid_amount
                  AND COALESCE(s.pay_by_date, e.pay_by_date) < current_date) AS overdue_shares
    `)
    ).rows[0];

    const signups = (
        await db.query(`
        SELECT to_char(d::date, 'YYYY-MM-DD') AS day, COUNT(u.id) AS count
        FROM generate_series(current_date - 29, current_date, interval '1 day') d
        LEFT JOIN users u ON u.created_at::date = d::date
        GROUP BY d ORDER BY d
    `)
    ).rows;

    const expenseVolume = (
        await db.query(`
        SELECT currency, COUNT(*) AS count, SUM(amount) AS total
        FROM expenses WHERE deleted_at IS NULL
        GROUP BY currency ORDER BY COUNT(*) DESC LIMIT 6
    `)
    ).rows;

    const outstanding = (
        await db.query(`
        SELECT e.currency, SUM(s.amount - s.paid_amount) AS pending, SUM(s.paid_amount) FILTER (WHERE s.user_id <> e.paid_by) AS collected
        FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
        WHERE e.deleted_at IS NULL AND s.user_id <> e.paid_by
        GROUP BY e.currency ORDER BY SUM(s.amount) DESC LIMIT 6
    `)
    ).rows;

    const revenue = (
        await db.query(`
        SELECT p.currency, SUM(p.price) AS total, COUNT(*) AS count
        FROM subscriptions s JOIN plans p ON p.id = s.plan_id
        GROUP BY p.currency
    `)
    ).rows;

    return {
        totals: {
            users: num(counts.users),
            verifiedUsers: num(counts.verified_users),
            newUsers7d: num(counts.new_users_7d),
            newUsers30d: num(counts.new_users_30d),
            groups: num(counts.groups),
            expenses: num(counts.expenses),
            settlements: num(counts.settlements),
            activeSubscriptions: num(counts.active_subscriptions),
            iosWaitlist: num(counts.ios_waitlist),
            emailsPending: num(counts.emails_pending),
            emailsFailed: num(counts.emails_failed),
            claimsPending: num(counts.claims_pending),
            claimsRejected30d: num(counts.claims_rejected_30d),
            payLinksActive: num(counts.pay_links_active),
            usersWithUpi: num(counts.users_with_upi),
            usersUpiVerified: num(counts.users_upi_verified),
            contactMembers: num(counts.contact_members),
            templates: num(counts.templates),
            overdueShares: num(counts.overdue_shares),
        },
        signups: signups.map((r) => ({ day: r.day, count: num(r.count) })),
        expenseVolume: expenseVolume.map((r) => ({
            currency: r.currency,
            count: num(r.count),
            total: r.total,
        })),
        outstanding: outstanding.map((r) => ({ currency: r.currency, pending: r.pending, collected: r.collected ?? '0' })),
        subscriptionRevenue: revenue.map((r) => ({
            currency: r.currency,
            total: r.total,
            count: num(r.count),
        })),
    };
}

// ------------------------------------------------------------------ users

function like(q: string | undefined): string | null {
    const value = q?.trim();
    if (!value) return null;
    return `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function listUsers(page: PageRequest, q: string | undefined, verified?: string) {
    const pattern = like(q);
    const where = `WHERE ($1::text IS NULL OR u.email ILIKE $1 OR u.display_name ILIKE $1 OR u.upi_id ILIKE $1 OR u.contact_email ILIKE $1 OR u.contact_phone ILIKE $1)
                   AND ($2::text IS NULL OR ($2 = 'yes') = (u.email_verified_at IS NOT NULL))`;
    const flag = verified === 'yes' || verified === 'no' ? verified : null;
    const total = num(
        (await db.query(`SELECT COUNT(*) AS n FROM users u ${where}`, [pattern, flag])).rows[0].n,
    );
    const rows = (
        await db.query(
            `SELECT u.id, u.email, u.display_name, u.created_at, u.email_verified_at,
                    (u.firebase_uid IS NOT NULL) AS google,
                    (u.disabled_at IS NOT NULL) AS suspended,
                    u.is_contact, u.upi_id, (u.upi_verified_at IS NOT NULL) AS upi_verified,
                    (SELECT COUNT(*) FROM group_members m WHERE m.user_id = u.id) AS groups,
                    EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id
                            AND s.status = 'ACTIVE' AND s.expires_at > now()) AS premium
             FROM users u ${where}
             ORDER BY u.created_at DESC LIMIT $3 OFFSET $4`,
            [pattern, flag, page.size, page.offset],
        )
    ).rows;
    return pageResponse(
        rows.map((r) => ({
            id: r.id,
            // People added from a phone's contacts have no real address of their own.
            email: r.is_contact ? null : r.email,
            isContact: r.is_contact,
            upiId: r.upi_id,
            upiVerified: r.upi_id ? r.upi_verified : false,
            displayName: r.display_name,
            createdAt: r.created_at,
            emailVerified: r.email_verified_at !== null,
            google: r.google,
            suspended: r.suspended,
            groups: num(r.groups),
            premium: r.premium,
        })),
        page,
        total,
    );
}

export async function userDetail(id: string) {
    const user = (await db.query('SELECT * FROM users WHERE id = $1', [id])).rows[0];
    if (!user) throw notFound('User not found');
    const groups = (
        await db.query(
            `SELECT g.id, g.name, g.default_currency, m.role, m.joined_at
             FROM group_members m JOIN expense_groups g ON g.id = m.group_id
             WHERE m.user_id = $1 ORDER BY m.joined_at DESC`,
            [id],
        )
    ).rows;
    const subscriptions = (
        await db.query(
            `SELECT s.id, s.status, s.starts_at, s.expires_at, s.provider, p.name AS plan
             FROM subscriptions s JOIN plans p ON p.id = s.plan_id
             WHERE s.user_id = $1 ORDER BY s.starts_at DESC`,
            [id],
        )
    ).rows;
    const stats = (
        await db.query(
            `SELECT
                (SELECT COUNT(*) FROM expenses WHERE paid_by = $1 AND deleted_at IS NULL) AS expenses_paid,
                (SELECT COUNT(*) FROM friendships WHERE first_user_id = $1 OR second_user_id = $1) AS friends,
                (SELECT COUNT(*) FROM expense_payment_claims WHERE user_id = $1) AS claims_made,
                (SELECT COUNT(*) FROM expense_payment_claims c JOIN expenses e ON e.id = c.expense_id WHERE e.paid_by = $1) AS claims_received,
                (SELECT COUNT(*) FROM expense_templates WHERE user_id = $1) AS templates,
                (SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1
                    AND revoked_at IS NULL AND consumed_at IS NULL AND expires_at > now()) AS sessions`,
            [id],
        )
    ).rows[0];
    // Money owed to and by this person, per currency (currencies are never added together).
    const balances = (
        await db.query(
            `SELECT e.currency,
                    COALESCE(SUM(s.amount - s.paid_amount) FILTER (WHERE e.paid_by = $1 AND s.user_id <> $1), 0) AS owed,
                    COALESCE(SUM(s.amount - s.paid_amount) FILTER (WHERE s.user_id = $1 AND e.paid_by <> $1), 0) AS owes
             FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
             WHERE e.deleted_at IS NULL AND (e.paid_by = $1 OR s.user_id = $1)
             GROUP BY e.currency ORDER BY e.currency`,
            [id],
        )
    ).rows;
    return {
        id: user.id,
        // Contacts added from a phone have no real address: show what the person who added them saved.
        email: user.is_contact ? (user.contact_email ?? '') : user.email,
        displayName: user.display_name,
        photoUrl: user.photo_url,
        createdAt: user.created_at,
        emailVerifiedAt: user.email_verified_at,
        disabledAt: user.disabled_at,
        disabledReason: user.disabled_reason,
        google: user.firebase_uid !== null,
        upiId: user.upi_id,
        upiVerifiedAt: user.upi_id ? user.upi_verified_at : null,
        isContact: user.is_contact,
        contact: user.is_contact
            ? { email: user.contact_email, phone: user.contact_phone, addedBy: user.added_by }
            : null,
        claimsMade: num(stats.claims_made),
        claimsReceived: num(stats.claims_received),
        templates: num(stats.templates),
        balances: balances.map((b) => ({ currency: b.currency, owed: b.owed, owes: b.owes })),
        expensesPaid: num(stats.expenses_paid),
        friends: num(stats.friends),
        activeSessions: num(stats.sessions),
        groups: groups.map((g) => ({
            id: g.id,
            name: g.name,
            currency: g.default_currency,
            role: g.role,
            joinedAt: g.joined_at,
        })),
        subscriptions: subscriptions.map((s) => ({
            id: s.id,
            plan: s.plan,
            status: s.status,
            provider: s.provider,
            startsAt: s.starts_at,
            expiresAt: s.expires_at,
        })),
    };
}

export async function revokeUserSessions(id: string): Promise<{ revoked: number }> {
    const result = await db.query(
        `UPDATE refresh_tokens SET revoked_at = $2
         WHERE user_id = $1 AND revoked_at IS NULL AND consumed_at IS NULL`,
        [id, new Date()],
    );
    return { revoked: result.rowCount };
}

export async function markUserVerified(id: string): Promise<void> {
    const result = await db.query(
        'UPDATE users SET email_verified_at = COALESCE(email_verified_at, $2) WHERE id = $1',
        [id, new Date()],
    );
    if (result.rowCount === 0) throw notFound('User not found');
}

// ----------------------------------------------------------------- groups

export async function listGroups(page: PageRequest, q: string | undefined) {
    const pattern = like(q);
    const total = num(
        (
            await db.query(
                'SELECT COUNT(*) AS n FROM expense_groups WHERE ($1::text IS NULL OR name ILIKE $1)',
                [pattern],
            )
        ).rows[0].n,
    );
    const rows = (
        await db.query(
            `SELECT g.id, g.name, g.default_currency, g.created_at, u.display_name AS owner,
                    (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS members,
                    (SELECT COUNT(*) FROM expenses e WHERE e.group_id = g.id AND e.deleted_at IS NULL) AS expenses
             FROM expense_groups g LEFT JOIN users u ON u.id = g.created_by
             WHERE ($1::text IS NULL OR g.name ILIKE $1)
             ORDER BY g.created_at DESC LIMIT $2 OFFSET $3`,
            [pattern, page.size, page.offset],
        )
    ).rows;
    return pageResponse(
        rows.map((r) => ({
            id: r.id,
            name: r.name,
            currency: r.default_currency,
            createdAt: r.created_at,
            owner: r.owner,
            members: num(r.members),
            expenses: num(r.expenses),
        })),
        page,
        total,
    );
}

export async function groupDetail(id: string) {
    const group = (await db.query('SELECT * FROM expense_groups WHERE id = $1', [id])).rows[0];
    if (!group) throw notFound('Group not found');
    const members = (
        await db.query(
            `SELECT u.id, u.display_name, u.email, m.role, m.joined_at, u.is_contact, u.upi_id, u.contact_phone
             FROM group_members m JOIN users u ON u.id = m.user_id
             WHERE m.group_id = $1 ORDER BY m.joined_at`,
            [id],
        )
    ).rows;
    const expenses = (
        await db.query(
            `SELECT e.id, e.description, e.amount, e.currency, e.expense_date, e.category,
                    u.display_name AS paid_by
             FROM expenses e LEFT JOIN users u ON u.id = e.paid_by
             WHERE e.group_id = $1 AND e.deleted_at IS NULL
             ORDER BY e.expense_date DESC, e.created_at DESC LIMIT 20`,
            [id],
        )
    ).rows;
    const totals = (
        await db.query(
            `SELECT currency, COUNT(*) AS count, SUM(amount) AS total FROM expenses
             WHERE group_id = $1 AND deleted_at IS NULL GROUP BY currency`,
            [id],
        )
    ).rows;
    const settlements = num(
        (await db.query('SELECT COUNT(*) AS n FROM settlements WHERE group_id = $1', [id])).rows[0].n,
    );
    const progress = (
        await db.query(
            `SELECT e.currency,
                    COUNT(*) FILTER (WHERE s.user_id <> e.paid_by) AS people,
                    COUNT(*) FILTER (WHERE s.user_id <> e.paid_by AND s.paid_amount >= s.amount) AS settled,
                    COALESCE(SUM(s.amount - s.paid_amount) FILTER (WHERE s.user_id <> e.paid_by), 0) AS pending,
                    COALESCE(SUM(s.paid_amount) FILTER (WHERE s.user_id <> e.paid_by), 0) AS collected
             FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
             WHERE e.group_id = $1 AND e.deleted_at IS NULL GROUP BY e.currency`,
            [id],
        )
    ).rows;
    return {
        id: group.id,
        name: group.name,
        currency: group.default_currency,
        createdAt: group.created_at,
        settlements,
        members: members.map((m) => ({
            id: m.id,
            displayName: m.display_name,
            email: m.is_contact ? null : m.email,
            isContact: m.is_contact,
            phone: m.is_contact ? m.contact_phone : null,
            upiId: m.upi_id,
            role: m.role,
            joinedAt: m.joined_at,
        })),
        progress: progress.map((p) => ({
            currency: p.currency,
            people: num(p.people),
            settled: num(p.settled),
            pending: p.pending,
            collected: p.collected,
        })),
        totals: totals.map((t) => ({ currency: t.currency, count: num(t.count), total: t.total })),
        recentExpenses: expenses.map((e) => ({
            id: e.id,
            description: e.description,
            amount: e.amount,
            currency: e.currency,
            date: e.expense_date,
            category: e.category,
            paidBy: e.paid_by,
        })),
    };
}

// ---------------------------------------------------------- subscriptions

export async function listSubscriptions(page: PageRequest, status: string | undefined) {
    const filter = status && /^[A-Z_]{1,20}$/.test(status) ? status : null;
    const total = num(
        (
            await db.query(
                'SELECT COUNT(*) AS n FROM subscriptions WHERE ($1::text IS NULL OR status = $1)',
                [filter],
            )
        ).rows[0].n,
    );
    const rows = (
        await db.query(
            `SELECT s.id, s.status, s.starts_at, s.expires_at, s.provider, p.name AS plan,
                    p.price, p.currency, u.id AS user_id, u.email
             FROM subscriptions s
             JOIN plans p ON p.id = s.plan_id
             LEFT JOIN users u ON u.id = s.user_id
             WHERE ($1::text IS NULL OR s.status = $1)
             ORDER BY s.starts_at DESC LIMIT $2 OFFSET $3`,
            [filter, page.size, page.offset],
        )
    ).rows;
    return pageResponse(
        rows.map((r) => ({
            id: r.id,
            status: r.status,
            plan: r.plan,
            price: r.price,
            currency: r.currency,
            provider: r.provider,
            startsAt: r.starts_at,
            expiresAt: r.expires_at,
            userId: r.user_id,
            email: r.email,
        })),
        page,
        total,
    );
}

export async function listPlans() {
    const rows = (
        await db.query(
            `SELECT p.*, (SELECT COUNT(*) FROM subscriptions s
                          WHERE s.plan_id = p.id AND s.status = 'ACTIVE' AND s.expires_at > now()) AS active_subscribers
             FROM plans p ORDER BY p.price`,
        )
    ).rows;
    return rows.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        price: p.price,
        currency: p.currency,
        durationDays: p.duration_days,
        removesAds: p.removes_ads,
        active: p.active,
        googleProductId: p.google_product_id,
        appleProductId: p.apple_product_id,
        activeSubscribers: num(p.active_subscribers),
    }));
}

export async function setPlanActive(id: string, active: boolean): Promise<void> {
    const result = await db.query('UPDATE plans SET active = $2 WHERE id = $1', [id, active]);
    if (result.rowCount === 0) throw notFound('Plan not found');
}

// ------------------------------------------------------------ app versions

export async function listAppVersions() {
    const rows = (
        await db.query(
            "SELECT * FROM app_versions WHERE platform = 'android' ORDER BY version_code DESC",
        )
    ).rows;
    return rows.map((r) => ({
        id: r.id,
        versionCode: r.version_code,
        versionName: r.version_name,
        minSupportedVersionCode: r.min_supported_version_code,
        apkUrl: r.apk_url,
        apkSha256: r.apk_sha256 ? r.apk_sha256.trim() : null,
        releaseNotes: r.release_notes,
        published: r.published,
        createdAt: r.created_at,
    }));
}

export async function publishAppVersion(input: {
    versionCode: number;
    versionName: string;
    minSupportedVersionCode: number;
    apkUrl: string;
    apkSha256: string | null;
    releaseNotes: string;
}) {
    if (input.minSupportedVersionCode > input.versionCode) {
        throw badRequest('minSupportedVersionCode cannot be higher than versionCode');
    }
    const id = randomUUID();
    try {
        await db.query(
            `INSERT INTO app_versions
                 (id, platform, version_code, version_name, min_supported_version_code, apk_url,
                  apk_sha256, release_notes, published)
             VALUES ($1, 'android', $2, $3, $4, $5, $6, $7, TRUE)`,
            [
                id,
                input.versionCode,
                input.versionName,
                input.minSupportedVersionCode,
                input.apkUrl,
                input.apkSha256,
                input.releaseNotes,
            ],
        );
    } catch (error) {
        if ((error as { code?: string }).code === '23505') {
            throw conflict(`Version code ${input.versionCode} already exists`);
        }
        throw error;
    }
    return { id };
}

export async function setAppVersionPublished(id: string, published: boolean): Promise<void> {
    const result = await db.query('UPDATE app_versions SET published = $2 WHERE id = $1', [
        id,
        published,
    ]);
    if (result.rowCount === 0) throw notFound('Version not found');
}

// -------------------------------------------------------------- ios waitlist

export async function listIosWaitlist(page: PageRequest, q: string | undefined) {
    const pattern = like(q);
    const total = num(
        (
            await db.query(
                'SELECT COUNT(*) AS n FROM ios_update_subscriptions WHERE ($1::text IS NULL OR email ILIKE $1)',
                [pattern],
            )
        ).rows[0].n,
    );
    const rows = (
        await db.query(
            `SELECT email, requested_at, confirmed_at FROM ios_update_subscriptions
             WHERE ($1::text IS NULL OR email ILIKE $1)
             ORDER BY requested_at DESC LIMIT $2 OFFSET $3`,
            [pattern, page.size, page.offset],
        )
    ).rows;
    return pageResponse(
        rows.map((r) => ({
            email: r.email,
            requestedAt: r.requested_at,
            confirmedAt: r.confirmed_at,
        })),
        page,
        total,
    );
}

// --------------------------------------------------------------- email queue

export async function listEmails(page: PageRequest, status: string | undefined) {
    const condition =
        status === 'pending'
            ? 'sent_at IS NULL AND failed_at IS NULL'
            : status === 'sent'
              ? 'sent_at IS NOT NULL'
              : status === 'failed'
                ? 'failed_at IS NOT NULL'
                : 'TRUE';
    const total = num((await db.query(`SELECT COUNT(*) AS n FROM email_queue WHERE ${condition}`)).rows[0].n);
    // Bodies are never returned: they can contain sign-in codes and links.
    const rows = (
        await db.query(
            `SELECT id, kind, to_address, subject, attempts, next_attempt_at, created_at, sent_at,
                    failed_at, last_error
             FROM email_queue WHERE ${condition}
             ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
            [page.size, page.offset],
        )
    ).rows;
    return pageResponse(
        rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            to: r.to_address,
            subject: r.subject,
            attempts: r.attempts,
            createdAt: r.created_at,
            sentAt: r.sent_at,
            failedAt: r.failed_at,
            lastError: r.last_error,
            status: r.sent_at ? 'sent' : r.failed_at ? 'failed' : 'pending',
        })),
        page,
        total,
    );
}

export async function retryEmail(id: string): Promise<void> {
    // Only abandoned emails whose body is still present can be retried.
    const result = await db.query(
        `UPDATE email_queue SET failed_at = NULL, attempts = 0, next_attempt_at = $2
         WHERE id = $1 AND failed_at IS NOT NULL AND sent_at IS NULL AND html <> ''`,
        [id, new Date()],
    );
    if (result.rowCount === 0) {
        throw badRequest('Only failed emails that still have their content can be retried');
    }
}

// ---------------------------------------------------------------- expenses

export async function listGroupExpenses(groupId: string, page: PageRequest, includeDeleted: boolean) {
    const group = (await db.query('SELECT id FROM expense_groups WHERE id = $1', [groupId])).rows[0];
    if (!group) throw notFound('Group not found');
    const condition = includeDeleted ? '' : 'AND e.deleted_at IS NULL';
    const total = num(
        (await db.query(`SELECT COUNT(*) AS n FROM expenses e WHERE e.group_id = $1 ${condition}`, [groupId])).rows[0].n,
    );
    const rows = (
        await db.query(
            `SELECT e.id, e.description, e.amount, e.currency, e.expense_date, e.category, e.deleted_at,
                    u.display_name AS paid_by,
                    (SELECT COUNT(*) FROM expense_attachments a WHERE a.expense_id = e.id) AS attachments
             FROM expenses e LEFT JOIN users u ON u.id = e.paid_by
             WHERE e.group_id = $1 ${condition}
             ORDER BY e.expense_date DESC, e.created_at DESC LIMIT $2 OFFSET $3`,
            [groupId, page.size, page.offset],
        )
    ).rows;
    return pageResponse(
        rows.map((e) => ({
            id: e.id,
            description: e.description,
            amount: e.amount,
            currency: e.currency,
            date: e.expense_date,
            category: e.category,
            paidBy: e.paid_by,
            attachments: num(e.attachments),
            deleted: e.deleted_at !== null,
        })),
        page,
        total,
    );
}

export async function expenseDetail(id: string) {
    const e = (
        await db.query(
            `SELECT e.*, g.name AS group_name, u.display_name AS paid_by_name, u.email AS paid_by_email
             FROM expenses e
             JOIN expense_groups g ON g.id = e.group_id
             LEFT JOIN users u ON u.id = e.paid_by
             WHERE e.id = $1`,
            [id],
        )
    ).rows[0];
    if (!e) throw notFound('Expense not found');
    const shares = (
        await db.query(
            `SELECT s.user_id, s.amount, s.paid_amount, s.pay_by_date, u.display_name, u.email, u.is_contact, u.upi_id
             FROM expense_shares s LEFT JOIN users u ON u.id = s.user_id
             WHERE s.expense_id = $1 ORDER BY u.display_name`,
            [id],
        )
    ).rows;
    const attachments = (
        await db.query(
            `SELECT id, name, content_type, octet_length(data) AS size, created_at
             FROM expense_attachments WHERE expense_id = $1 ORDER BY position`,
            [id],
        )
    ).rows;
    const history = (
        await db.query(
            `SELECT a.action, a.revision, a.occurred_at, a.snapshot, a.actor_id, u.display_name AS actor
             FROM expense_audit a LEFT JOIN users u ON u.id = a.actor_id
             WHERE a.expense_id = $1 ORDER BY a.revision`,
            [id],
        )
    ).rows;
    const claims = (
        await db.query(
            `SELECT c.id, c.amount, c.status, c.created_at, c.resolved_at, u.display_name, c.user_id
             FROM expense_payment_claims c LEFT JOIN users u ON u.id = c.user_id
             WHERE c.expense_id = $1 ORDER BY c.created_at DESC`,
            [id],
        )
    ).rows;
    // Names for the change descriptions.
    const ids = new Set<string>([e.paid_by]);
    for (const h of history) {
        snapshotUserIds(h.snapshot).forEach((u) => ids.add(u));
    }
    const names = new Map<string, string>(
        (await db.query('SELECT id, display_name FROM users WHERE id = ANY($1::uuid[])', [[...ids]])).rows.map((r) => [r.id, r.display_name]),
    );
    const nameOf = (uid: string) => names.get(uid) ?? 'Someone';
    let previous: string | null = null;
    const historyViews = history.map((h) => {
        const changes = h.action === 'CREATED' ? [] : describeChanges(previous, h.snapshot, nameOf);
        previous = h.snapshot;
        return {
            action: h.action,
            revision: h.revision,
            actor: h.actor,
            at: h.occurred_at,
            summary: summarize(h.action, changes, parseSnapshot(h.snapshot), nameOf, h.actor ?? 'Someone'),
            changes,
        };
    });
    return {
        id: e.id,
        groupId: e.group_id,
        groupName: e.group_name,
        description: e.description,
        amount: e.amount,
        currency: e.currency,
        date: e.expense_date,
        category: e.category,
        notes: e.notes,
        splitType: e.split_type,
        remindAfterDays: e.remind_after_days,
        payByDate: e.pay_by_date,
        reminderSentAt: e.reminder_sent_at,
        createdAt: e.created_at,
        updatedAt: e.updated_at,
        deletedAt: e.deleted_at,
        paidBy: { id: e.paid_by, name: e.paid_by_name, email: e.paid_by_email },
        shares: shares.map((s) => ({
            userId: s.user_id,
            name: s.display_name,
            email: s.is_contact ? null : s.email,
            isContact: s.is_contact,
            upiId: s.upi_id,
            amount: s.amount,
            paidAmount: s.user_id === e.paid_by ? s.amount : s.paid_amount,
            dueDate: s.pay_by_date ?? e.pay_by_date,
            status: s.user_id === e.paid_by || Number(s.paid_amount) >= Number(s.amount) ? 'PAID' : Number(s.paid_amount) > 0 ? 'PARTIAL' : 'UNPAID',
            isPayer: s.user_id === e.paid_by,
        })),
        claims: claims.map((c) => ({
            id: c.id,
            userId: c.user_id,
            name: c.display_name,
            amount: c.amount,
            status: c.status,
            createdAt: c.created_at,
            resolvedAt: c.resolved_at,
        })),
        attachments: attachments.map((a) => ({
            id: a.id,
            name: a.name,
            contentType: a.content_type,
            size: num(a.size),
            createdAt: a.created_at,
        })),
        history: historyViews,
    };
}

export async function readAttachmentForAdmin(id: string) {
    const row = (
        await db.query('SELECT name, content_type, data FROM expense_attachments WHERE id = $1', [id])
    ).rows[0];
    if (!row) throw notFound('Attachment not found');
    return { name: row.name as string, contentType: row.content_type as string, data: row.data as Buffer };
}

// ----------------------------------------------------- payment claims, pay links

/** "I've paid" claims across the app, newest first. */
export async function listClaims(page: PageRequest, status: string | undefined) {
    const value = status && ['PENDING', 'CONFIRMED', 'REJECTED'].includes(status.toUpperCase()) ? status.toUpperCase() : null;
    const total = num(
        (await db.query('SELECT COUNT(*) AS n FROM expense_payment_claims WHERE ($1::text IS NULL OR status = $1)', [value])).rows[0].n,
    );
    const rows = (
        await db.query(
            `SELECT c.id, c.amount, c.status, c.created_at, c.resolved_at, c.expense_id, c.group_id,
                    e.description, e.currency, g.name AS group_name,
                    cu.display_name AS claimant, cu.id AS claimant_id, pu.display_name AS payer, pu.id AS payer_id
             FROM expense_payment_claims c
             JOIN expenses e ON e.id = c.expense_id
             JOIN expense_groups g ON g.id = c.group_id
             LEFT JOIN users cu ON cu.id = c.user_id
             LEFT JOIN users pu ON pu.id = e.paid_by
             WHERE ($1::text IS NULL OR c.status = $1)
             ORDER BY c.created_at DESC LIMIT $2 OFFSET $3`,
            [value, page.size, page.offset],
        )
    ).rows;
    return pageResponse(
        rows.map((r) => ({
            id: r.id,
            amount: r.amount,
            currency: r.currency,
            status: r.status,
            createdAt: r.created_at,
            resolvedAt: r.resolved_at,
            expenseId: r.expense_id,
            description: r.description,
            groupId: r.group_id,
            groupName: r.group_name,
            claimant: { id: r.claimant_id, name: r.claimant },
            payer: { id: r.payer_id, name: r.payer },
        })),
        page,
        total,
    );
}

/** Short pay links people have shared. The code itself is never shown, only a short prefix to tell them apart. */
export async function listPayLinks(page: PageRequest, state: string | undefined) {
    const condition = state === 'expired' ? 'expires_at <= now()' : state === 'active' ? 'expires_at > now()' : 'TRUE';
    const total = num((await db.query(`SELECT COUNT(*) AS n FROM pay_links WHERE ${condition}`)).rows[0].n);
    const rows = (
        await db.query(
            `SELECT l.code, l.created_at, l.expires_at, l.payload, u.display_name AS creator, u.id AS creator_id
             FROM pay_links l LEFT JOIN users u ON u.id = l.created_by
             WHERE ${condition.replace(/expires_at/g, 'l.expires_at')}
             ORDER BY l.created_at DESC LIMIT $1 OFFSET $2`,
            [page.size, page.offset],
        )
    ).rows;
    return pageResponse(
        rows.map((r) => ({
            id: r.code,
            prefix: String(r.code).slice(0, 3) + '…',
            createdAt: r.created_at,
            expiresAt: r.expires_at,
            active: new Date(r.expires_at) > new Date(),
            creator: { id: r.creator_id, name: r.creator },
            description: r.payload?.d ?? '',
            currency: r.payload?.c ?? '',
            people: Array.isArray(r.payload?.t) ? r.payload.t.length : 0,
            total: Array.isArray(r.payload?.t)
                ? r.payload.t.reduce((sum: number, p: { a: string }) => sum + Number(p.a), 0).toFixed(2)
                : '0.00',
            acceptsClaims: Boolean(r.payload?.g),
        })),
        page,
        total,
    );
}

/** Every invoice issued, searchable by number, name, group or item. */
export async function listInvoices(page: PageRequest, q: string | undefined) {
    const needle = like(q);
    const where = `($1::text IS NULL OR i.number ILIKE $1 OR pe.display_name ILIKE $1 OR pr.display_name ILIKE $1
                    OR g.name ILIKE $1 OR i.items::text ILIKE $1)`;
    const from = `FROM invoices i
        LEFT JOIN users pe ON pe.id = i.payee_id
        LEFT JOIN users pr ON pr.id = i.payer_id
        LEFT JOIN expense_groups g ON g.id = i.group_id`;
    const total = num((await db.query(`SELECT COUNT(*) AS n ${from} WHERE ${where}`, [needle])).rows[0].n);
    const rows = (
        await db.query(
            `SELECT i.number, i.status, i.currency, i.total, i.paid, i.paid_at, i.group_id, jsonb_array_length(i.items) AS items,
                    pe.id AS payee_id, pe.display_name AS payee, pr.id AS payer_id, pr.display_name AS payer, g.name AS group_name
             ${from} WHERE ${where}
             ORDER BY i.paid_at DESC LIMIT $2 OFFSET $3`,
            [needle, page.size, page.offset],
        )
    ).rows;
    return pageResponse(
        rows.map((r) => ({
            number: r.number,
            status: r.status,
            currency: r.currency,
            total: r.total,
            paid: r.paid,
            paidAt: r.paid_at,
            items: num(r.items),
            groupId: r.group_id,
            groupName: r.group_name,
            payee: { id: r.payee_id, name: r.payee },
            payer: { id: r.payer_id, name: r.payer },
        })),
        page,
        total,
    );
}
