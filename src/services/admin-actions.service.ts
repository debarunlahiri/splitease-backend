import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Db, db, PG_UNIQUE_VIOLATION, pgErrorCode, tx } from '../database';
import { badCredentials, badRequest, conflict, notFound } from '../utils/errors';
import { PageRequest, pageResponse } from '../utils/http';
import * as auth from './auth.service';
import { deleteExpense } from './expense.service';

export interface Actor {
    id: string;
    email: string;
}

const num = (value: unknown): number => Number(value ?? 0);

// ------------------------------------------------------------------ audit

export async function audit(
    actor: Actor,
    action: string,
    targetType: string | null,
    targetId: string | null,
    detail?: Record<string, unknown>,
    conn: Db = db,
): Promise<void> {
    await conn.query(
        `INSERT INTO admin_audit (id, admin_id, admin_email, action, target_type, target_id, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
            randomUUID(),
            actor.id,
            actor.email,
            action,
            targetType,
            targetId,
            detail ? JSON.stringify(detail).slice(0, 2000) : null,
        ],
    );
}

export async function listAudit(page: PageRequest, action: string | undefined) {
    const filter = action && /^[a-z._-]{1,60}$/.test(action) ? `${action}%` : null;
    const total = num(
        (
            await db.query('SELECT COUNT(*) AS n FROM admin_audit WHERE ($1::text IS NULL OR action LIKE $1)', [
                filter,
            ])
        ).rows[0].n,
    );
    const rows = (
        await db.query(
            `SELECT * FROM admin_audit WHERE ($1::text IS NULL OR action LIKE $1)
             ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
            [filter, page.size, page.offset],
        )
    ).rows;
    return pageResponse(
        rows.map((r) => ({
            id: r.id,
            admin: r.admin_email,
            action: r.action,
            targetType: r.target_type,
            targetId: r.target_id,
            detail: r.detail ? safeJson(r.detail) : null,
            createdAt: r.created_at,
        })),
        page,
        total,
    );
}

function safeJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

// ------------------------------------------------------------------ users

export async function setUserSuspended(
    actor: Actor,
    id: string,
    suspended: boolean,
    reason: string | null,
): Promise<void> {
    await tx(async (conn) => {
        const result = await conn.query(
            'UPDATE users SET disabled_at = $2, disabled_reason = $3 WHERE id = $1',
            [id, suspended ? new Date() : null, suspended ? reason : null],
        );
        if (result.rowCount === 0) throw notFound('User not found');
        if (suspended) {
            await conn.query(
                `UPDATE refresh_tokens SET revoked_at = $2
                 WHERE user_id = $1 AND revoked_at IS NULL AND consumed_at IS NULL`,
                [id, new Date()],
            );
        }
        await audit(actor, suspended ? 'user.suspend' : 'user.restore', 'user', id, { reason }, conn);
    });
}

export async function renameUser(actor: Actor, id: string, displayName: string): Promise<void> {
    const result = await db.query('UPDATE users SET display_name = $2 WHERE id = $1', [id, displayName]);
    if (result.rowCount === 0) throw notFound('User not found');
    await audit(actor, 'user.rename', 'user', id, { displayName });
}

export async function resendVerification(actor: Actor, id: string): Promise<void> {
    const user = (await db.query('SELECT email, email_verified_at FROM users WHERE id = $1', [id])).rows[0];
    if (!user) throw notFound('User not found');
    if (user.email_verified_at) throw badRequest('This email is already verified');
    await auth.resendVerification({ email: user.email });
    await audit(actor, 'user.resend-verification', 'user', id);
}

/** Only accounts that never used the app can be deleted; everyone else should be suspended. */
export async function deleteUser(actor: Actor, id: string): Promise<void> {
    await tx(async (conn) => {
        const user = (await conn.query('SELECT id, email FROM users WHERE id = $1 FOR UPDATE', [id])).rows[0];
        if (!user) throw notFound('User not found');
        const usage = (
            await conn.query(
                `SELECT
                    (SELECT COUNT(*) FROM group_members WHERE user_id = $1) AS groups,
                    (SELECT COUNT(*) FROM expenses WHERE paid_by = $1) AS paid,
                    (SELECT COUNT(*) FROM expense_shares WHERE user_id = $1) AS shares,
                    (SELECT COUNT(*) FROM settlements WHERE payer_id = $1 OR payee_id = $1) AS settlements`,
                [id],
            )
        ).rows[0];
        if (num(usage.groups) + num(usage.paid) + num(usage.shares) + num(usage.settlements) > 0) {
            throw conflict(
                'This user is part of groups or expenses, so deleting them would break other people’s balances. Suspend the account instead.',
            );
        }
        await conn.query('DELETE FROM notifications WHERE user_id = $1', [id]);
        await conn.query('DELETE FROM notification_preferences WHERE user_id = $1', [id]);
        await conn.query('DELETE FROM subscriptions WHERE user_id = $1', [id]);
        await conn.query('DELETE FROM users WHERE id = $1', [id]);
        await audit(actor, 'user.delete', 'user', id, { email: user.email }, conn);
    });
}

export async function notifyUser(actor: Actor, id: string, title: string, message: string): Promise<void> {
    const user = (await db.query('SELECT id FROM users WHERE id = $1', [id])).rows[0];
    if (!user) throw notFound('User not found');
    await db.query(
        `INSERT INTO notifications (id, user_id, type, title, message, is_read, inbox_visible, created_at)
         VALUES ($1, $2, 'ANNOUNCEMENT', $3, $4, FALSE, TRUE, $5)`,
        [randomUUID(), id, title, message, new Date()],
    );
    await audit(actor, 'user.notify', 'user', id, { title });
}

// ----------------------------------------------------------- announcements

export async function broadcast(
    actor: Actor,
    input: { title: string; message: string; audience: 'all' | 'verified' | 'premium'; push: boolean },
): Promise<{ recipients: number }> {
    const recipients = await tx(async (conn) => {
        const inserted = (
            await conn.query(
                `WITH targets AS (
                     SELECT u.id FROM users u
                     LEFT JOIN notification_preferences p ON p.user_id = u.id
                     WHERE u.disabled_at IS NULL
                       AND COALESCE(p.inbox_enabled, TRUE)
                       AND ($1 = 'all'
                            OR ($1 = 'verified' AND u.email_verified_at IS NOT NULL)
                            OR ($1 = 'premium' AND EXISTS (
                                   SELECT 1 FROM subscriptions s WHERE s.user_id = u.id
                                   AND s.status = 'ACTIVE' AND s.expires_at > now())))
                 ), ins AS (
                     INSERT INTO notifications
                         (id, user_id, type, title, message, is_read, inbox_visible, created_at)
                     SELECT gen_random_uuid(), id, 'ANNOUNCEMENT', $2, $3, FALSE, TRUE, now() FROM targets
                     RETURNING id, user_id
                 )
                 SELECT id, user_id FROM ins`,
                [input.audience, input.title, input.message],
            )
        ).rows;
        if (input.push && inserted.length > 0) {
            await conn.query(
                `INSERT INTO push_deliveries (id, notification_id, user_id, next_attempt_at, attempts)
                 SELECT gen_random_uuid(), n.id, n.user_id, now(), 0
                 FROM unnest($1::uuid[], $2::uuid[]) AS n(id, user_id)
                 JOIN notification_preferences p ON p.user_id = n.user_id
                 WHERE p.push_enabled AND p.push_token IS NOT NULL`,
                [inserted.map((r) => r.id), inserted.map((r) => r.user_id)],
            );
        }
        await audit(
            actor,
            'announcement.send',
            null,
            null,
            { title: input.title, audience: input.audience, push: input.push, recipients: inserted.length },
            conn,
        );
        return inserted.length;
    });
    return { recipients };
}

export async function audienceSizes() {
    const row = (
        await db.query(`
        SELECT COUNT(*) AS everyone,
               COUNT(*) FILTER (WHERE email_verified_at IS NOT NULL) AS verified,
               COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = users.id
                                AND s.status = 'ACTIVE' AND s.expires_at > now())) AS premium
        FROM users WHERE disabled_at IS NULL`)
    ).rows[0];
    return { all: num(row.everyone), verified: num(row.verified), premium: num(row.premium) };
}

// ----------------------------------------------------------- subscriptions

export async function grantSubscription(
    actor: Actor,
    input: { user: string; planId: string; days: number | null },
): Promise<{ id: string }> {
    const isId = /^[0-9a-f-]{36}$/i.test(input.user);
    const user = (
        await db.query(isId ? 'SELECT id, email FROM users WHERE id = $1' : 'SELECT id, email FROM users WHERE email = $1', [
            isId ? input.user.toLowerCase() : input.user.trim().toLowerCase(),
        ])
    ).rows[0];
    if (!user) throw notFound('No user with that email');
    const plan = (await db.query('SELECT * FROM plans WHERE id = $1', [input.planId])).rows[0];
    if (!plan) throw notFound('Plan not found');
    const days = input.days ?? plan.duration_days;
    const now = new Date();
    const id = randomUUID();
    await db.query(
        `INSERT INTO subscriptions
             (id, user_id, plan_id, status, starts_at, expires_at, provider, provider_reference)
         VALUES ($1, $2, $3, 'ACTIVE', $4, $5, 'ADMIN', $6)`,
        [id, user.id, plan.id, now, new Date(now.getTime() + days * 86_400_000), `admin:${id}`],
    );
    await audit(actor, 'subscription.grant', 'user', user.id, { plan: plan.code, days, email: user.email });
    return { id };
}

export async function setSubscriptionActive(actor: Actor, id: string, active: boolean): Promise<void> {
    const result = await db.query(
        'UPDATE subscriptions SET status = $2 WHERE id = $1',
        [id, active ? 'ACTIVE' : 'INACTIVE'],
    );
    if (result.rowCount === 0) throw notFound('Subscription not found');
    await audit(actor, active ? 'subscription.reactivate' : 'subscription.cancel', 'subscription', id);
}

export async function extendSubscription(actor: Actor, id: string, days: number): Promise<void> {
    const result = await db.query(
        `UPDATE subscriptions
         SET expires_at = GREATEST(expires_at, now()) + make_interval(days => $2), status = 'ACTIVE'
         WHERE id = $1`,
        [id, days],
    );
    if (result.rowCount === 0) throw notFound('Subscription not found');
    await audit(actor, 'subscription.extend', 'subscription', id, { days });
}

// ------------------------------------------------------------------ groups

export async function renameGroup(actor: Actor, id: string, name: string): Promise<void> {
    const result = await db.query('UPDATE expense_groups SET name = $2 WHERE id = $1', [id, name]);
    if (result.rowCount === 0) throw notFound('Group not found');
    await audit(actor, 'group.rename', 'group', id, { name });
}

export async function deleteGroup(actor: Actor, id: string): Promise<void> {
    await tx(async (conn) => {
        const group = (await conn.query('SELECT name FROM expense_groups WHERE id = $1 FOR UPDATE', [id])).rows[0];
        if (!group) throw notFound('Group not found');
        // These tables carry the group id without a foreign key, so they are cleared by hand.
        await conn.query('DELETE FROM notifications WHERE group_id = $1', [id]);
        await conn.query('DELETE FROM expense_audit WHERE group_id = $1', [id]);
        await conn.query('DELETE FROM expense_projections WHERE group_id = $1', [id]);
        await conn.query('DELETE FROM settlements WHERE group_id = $1', [id]);
        await conn.query('DELETE FROM group_balances WHERE group_id = $1', [id]);
        await conn.query('DELETE FROM expenses WHERE group_id = $1', [id]);
        await conn.query('DELETE FROM pending_invitation_alerts WHERE group_id = $1', [id]);
        await conn.query('DELETE FROM expense_groups WHERE id = $1', [id]);
        await audit(actor, 'group.delete', 'group', id, { name: group.name }, conn);
    });
}

// ------------------------------------------------------------- app versions

export async function deleteAppVersion(actor: Actor, id: string): Promise<void> {
    const row = (await db.query('DELETE FROM app_versions WHERE id = $1 RETURNING version_name', [id])).rows[0];
    if (!row) throw notFound('Version not found');
    await audit(actor, 'release.delete', 'release', id, { version: row.version_name });
}

// ------------------------------------------------------------- misc queues

export async function deleteWaitlistEntry(actor: Actor, email: string): Promise<void> {
    const result = await db.query('DELETE FROM ios_update_subscriptions WHERE email = $1', [email.toLowerCase()]);
    if (result.rowCount === 0) throw notFound('Entry not found');
    await audit(actor, 'waitlist.remove', 'waitlist', email.toLowerCase());
}

export async function exportWaitlist(): Promise<{ email: string; requestedAt: Date; confirmedAt: Date | null }[]> {
    const rows = (
        await db.query('SELECT email, requested_at, confirmed_at FROM ios_update_subscriptions ORDER BY requested_at')
    ).rows;
    return rows.map((r) => ({ email: r.email, requestedAt: r.requested_at, confirmedAt: r.confirmed_at }));
}

export async function discardEmail(actor: Actor, id: string): Promise<void> {
    const result = await db.query(
        `UPDATE email_queue SET failed_at = COALESCE(failed_at, $2), html = '', text_body = '',
                last_error = COALESCE(last_error, 'Discarded by an admin')
         WHERE id = $1 AND sent_at IS NULL`,
        [id, new Date()],
    );
    if (result.rowCount === 0) throw badRequest('Only emails that have not been sent can be discarded');
    await audit(actor, 'email.discard', 'email', id);
}

// ------------------------------------------------------------------ admins

export async function listAdmins() {
    const rows = (await db.query('SELECT * FROM admin_users ORDER BY created_at')).rows;
    return rows.map((r) => ({
        id: r.id,
        email: r.email,
        displayName: r.display_name,
        createdAt: r.created_at,
        lastLoginAt: r.last_login_at,
        disabled: r.disabled_at !== null,
    }));
}

export async function addAdmin(
    actor: Actor,
    input: { email: string; displayName: string; password: string },
): Promise<{ id: string }> {
    const id = randomUUID();
    try {
        await db.query(
            'INSERT INTO admin_users (id, email, display_name, password_hash) VALUES ($1, $2, $3, $4)',
            [id, input.email.trim().toLowerCase(), input.displayName.trim(), await bcrypt.hash(input.password, 12)],
        );
    } catch (error) {
        if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) throw conflict('An admin with that email already exists');
        throw error;
    }
    await audit(actor, 'admin.create', 'admin', id, { email: input.email });
    return { id };
}

export async function setAdminDisabled(actor: Actor, id: string, disabled: boolean): Promise<void> {
    if (disabled && id === actor.id) throw badRequest('You cannot disable your own account');
    if (disabled) {
        const others = num(
            (await db.query('SELECT COUNT(*) AS n FROM admin_users WHERE disabled_at IS NULL AND id <> $1', [id])).rows[0].n,
        );
        if (others === 0) throw badRequest('At least one admin must stay enabled');
    }
    const result = await db.query('UPDATE admin_users SET disabled_at = $2 WHERE id = $1', [
        id,
        disabled ? new Date() : null,
    ]);
    if (result.rowCount === 0) throw notFound('Admin not found');
    await audit(actor, disabled ? 'admin.disable' : 'admin.enable', 'admin', id);
}

export async function changeOwnPassword(actor: Actor, current: string, next: string): Promise<void> {
    const row = (await db.query('SELECT password_hash FROM admin_users WHERE id = $1', [actor.id])).rows[0];
    if (!row || !(await bcrypt.compare(current, row.password_hash))) {
        throw badCredentials('Your current password is wrong');
    }
    await db.query('UPDATE admin_users SET password_hash = $2 WHERE id = $1', [
        actor.id,
        await bcrypt.hash(next, 12),
    ]);
    await audit(actor, 'admin.password-change', 'admin', actor.id);
}

// ------------------------------------------------------------------- plans

export interface PlanInput {
    name: string;
    price: number;
    currency: string;
    durationDays: number;
    removesAds: boolean;
    active: boolean;
    googleProductId: string | null;
    appleProductId: string | null;
}

function planConflict(error: unknown): never {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
        throw conflict('A plan with that code or store product ID already exists');
    }
    throw error;
}

export async function createPlan(actor: Actor, input: PlanInput & { code: string }): Promise<{ id: string }> {
    const id = randomUUID();
    try {
        await db.query(
            `INSERT INTO plans (id, code, name, price, currency, duration_days, removes_ads, active,
                                google_product_id, apple_product_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
                id,
                input.code,
                input.name,
                input.price,
                input.currency,
                input.durationDays,
                input.removesAds,
                input.active,
                input.googleProductId,
                input.appleProductId,
            ],
        );
    } catch (error) {
        planConflict(error);
    }
    await audit(actor, 'plan.create', 'plan', id, { code: input.code, price: input.price });
    return { id };
}

/** The code never changes after creation: purchases and the app refer to it. */
export async function updatePlan(actor: Actor, id: string, input: PlanInput): Promise<void> {
    try {
        const result = await db.query(
            `UPDATE plans SET name = $2, price = $3, currency = $4, duration_days = $5,
                              removes_ads = $6, active = $7, google_product_id = $8,
                              apple_product_id = $9
             WHERE id = $1`,
            [
                id,
                input.name,
                input.price,
                input.currency,
                input.durationDays,
                input.removesAds,
                input.active,
                input.googleProductId,
                input.appleProductId,
            ],
        );
        if (result.rowCount === 0) throw notFound('Plan not found');
    } catch (error) {
        if (error instanceof Error && 'status' in error) throw error;
        planConflict(error);
    }
    await audit(actor, 'plan.update', 'plan', id, { name: input.name, price: input.price });
}

export async function deletePlan(actor: Actor, id: string): Promise<void> {
    const plan = (await db.query('SELECT code FROM plans WHERE id = $1', [id])).rows[0];
    if (!plan) throw notFound('Plan not found');
    const used = num((await db.query('SELECT COUNT(*) AS n FROM subscriptions WHERE plan_id = $1', [id])).rows[0].n);
    if (used > 0) {
        throw conflict(`${used} subscription(s) use this plan, so it can’t be deleted. Hide it instead.`);
    }
    await db.query('DELETE FROM plans WHERE id = $1', [id]);
    await audit(actor, 'plan.delete', 'plan', id, { code: plan.code });
}

// ---------------------------------------------------------------- expenses

export async function adminDeleteExpense(actor: Actor, id: string): Promise<void> {
    await tx(async (conn) => {
        const expense = (await conn.query('SELECT paid_by, description, amount, currency, group_id FROM expenses WHERE id = $1', [id])).rows[0];
        if (!expense) throw notFound('Expense not found');
        // Uses the app's own delete so balances are reversed and members' views stay consistent.
        // The event is attributed to the payer because app events need an app user id.
        await deleteExpense(conn, expense.paid_by, id, { skipEditorCheck: true });
        await audit(
            actor,
            'expense.delete',
            'expense',
            id,
            { description: expense.description, amount: expense.amount, currency: expense.currency, groupId: expense.group_id },
            conn,
        );
    });
}

export async function removeAttachment(actor: Actor, id: string): Promise<void> {
    const row = (
        await db.query('DELETE FROM expense_attachments WHERE id = $1 RETURNING name, expense_id', [id])
    ).rows[0];
    if (!row) throw notFound('Attachment not found');
    await audit(actor, 'attachment.remove', 'expense', row.expense_id, { name: row.name });
}

/** Switches a pay link off right away (for example if it was shared by mistake). */
export async function revokePayLink(actor: Actor, code: string): Promise<void> {
    const row = (
        await db.query('DELETE FROM pay_links WHERE code = $1 RETURNING created_by', [code])
    ).rows[0];
    if (!row) throw notFound('Pay link not found');
    await audit(actor, 'paylink.revoke', 'user', row.created_by, { prefix: code.slice(0, 3) });
}
