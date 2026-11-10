import { randomUUID } from 'node:crypto';
import { getMessaging } from 'firebase-admin/messaging';
import { config } from '../config';
import { Db, tx } from '../database';
import { badRequest, notFound } from '../utils/errors';
import { firebaseApp } from '../config/firebase';
import { PageRequest, PageResponse, pageResponse } from '../utils/http';
import { logger } from '../utils/logger';
import { subscribe } from '../events/outbox';
import {
    ConnectionAddedEvent,
    connectionAddedMessage,
    ExpenseChangedEvent,
    ExpenseCreatedEvent,
    ExpenseSnapshot,
    InvitationCreatedEvent,
    SettlementRecordedEvent,
    Topics,
} from '../events/types';
import { groupName } from './group.service';

export interface NotificationView {
    id: string;
    type: string;
    title: string;
    message: string;
    read: boolean;
    createdAt: Date;
    groupId: string | null;
    invitationId: string | null;
    expenseId: string | null;
}

export interface PreferenceView {
    inboxEnabled: boolean;
    pushEnabled: boolean;
    pushToken: string | null;
}

interface Targets {
    groupId?: string | null;
    invitationId?: string | null;
    expenseId?: string | null;
}

function notificationView(row: any): NotificationView {
    return {
        id: row.id,
        type: row.type,
        title: row.title,
        message: row.message,
        read: row.is_read,
        createdAt: row.created_at,
        groupId: row.group_id,
        invitationId: row.invitation_id,
        expenseId: row.expense_id,
    };
}

function preferenceView(row: any): PreferenceView {
    return {
        inboxEnabled: row.inbox_enabled,
        pushEnabled: row.push_enabled,
        pushToken: row.push_token,
    };
}

// ------------------------------------------------------------------- inbox

export async function listNotifications(
    db: Db,
    userId: string,
    page: PageRequest,
): Promise<PageResponse<NotificationView>> {
    const total = (
        await db.query(
            'SELECT COUNT(*) AS total FROM notifications WHERE user_id = $1 AND inbox_visible',
            [userId],
        )
    ).rows[0].total;
    const rows = (
        await db.query(
            `SELECT * FROM notifications WHERE user_id = $1 AND inbox_visible
             ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
            [userId, page.size, page.offset],
        )
    ).rows;
    return pageResponse(rows.map(notificationView), page, total);
}

export async function unreadCount(db: Db, userId: string): Promise<{ count: number }> {
    const row = (
        await db.query(
            `SELECT COUNT(*) AS total FROM notifications
             WHERE user_id = $1 AND inbox_visible AND NOT is_read`,
            [userId],
        )
    ).rows[0];
    return { count: row.total };
}

export async function markRead(
    db: Db,
    userId: string,
    notificationId: string,
): Promise<NotificationView> {
    const row = (
        await db.query(
            `UPDATE notifications SET is_read = TRUE
             WHERE id = $1 AND user_id = $2 AND inbox_visible RETURNING *`,
            [notificationId, userId],
        )
    ).rows[0];
    if (!row) throw notFound('Notification not found');
    return notificationView(row);
}

export async function markAllRead(db: Db, userId: string): Promise<void> {
    await db.query(
        `UPDATE notifications SET is_read = TRUE
         WHERE user_id = $1 AND inbox_visible AND NOT is_read`,
        [userId],
    );
}

// ------------------------------------------------------------- preferences

export async function preferences(db: Db, userId: string): Promise<PreferenceView> {
    const row = (
        await db.query('SELECT * FROM notification_preferences WHERE user_id = $1', [userId])
    ).rows[0];
    return row ? preferenceView(row) : { inboxEnabled: true, pushEnabled: false, pushToken: null };
}

export async function updatePreferences(
    db: Db,
    userId: string,
    input: { inboxEnabled: boolean; pushEnabled: boolean; pushToken: string | null },
): Promise<PreferenceView> {
    const pushToken = input.pushToken === null ? null : input.pushToken.trim();
    if (input.pushEnabled && !pushToken) {
        throw badRequest('A push token is required when push is enabled');
    }
    const row = (
        await db.query(
            `INSERT INTO notification_preferences (user_id, inbox_enabled, push_enabled, push_token)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id) DO UPDATE SET
                 inbox_enabled = EXCLUDED.inbox_enabled,
                 push_enabled = EXCLUDED.push_enabled,
                 push_token = EXCLUDED.push_token
             RETURNING *`,
            [userId, input.inboxEnabled, input.pushEnabled, pushToken],
        )
    ).rows[0];
    return preferenceView(row);
}

// ------------------------------------------------------------------ writer

/** Stores a notification according to the user's preferences and queues its push. */
async function writeNotification(
    db: Db,
    userId: string,
    type: string,
    title: string,
    message: string,
    targets: Targets,
): Promise<void> {
    const preference = (
        await db.query('SELECT * FROM notification_preferences WHERE user_id = $1', [userId])
    ).rows[0];
    const inbox = !preference || preference.inbox_enabled;
    const push = Boolean(preference && preference.push_enabled);
    if (!inbox && !push) return;
    const id = randomUUID();
    await db.query(
        `INSERT INTO notifications
             (id, user_id, type, title, message, is_read, inbox_visible, created_at,
              group_id, invitation_id, expense_id)
         VALUES ($1, $2, $3, $4, $5, FALSE, $6, $7, $8, $9, $10)`,
        [
            id,
            userId,
            type,
            title.slice(0, 140),
            message.slice(0, 500),
            inbox,
            new Date(),
            targets.groupId ?? null,
            targets.invitationId ?? null,
            targets.expenseId ?? null,
        ],
    );
    if (push) {
        await db.query(
            `INSERT INTO push_deliveries (id, notification_id, user_id, next_attempt_at, attempts)
             VALUES ($1, $2, $3, $4, 0)`,
            [randomUUID(), id, userId, new Date()],
        );
    }
}

// ------------------------------------------------------- invitation alerts

async function deliverAlert(db: Db, alert: any, userId: string): Promise<void> {
    if (alert.expires_at.getTime() > Date.now()) {
        await writeNotification(
            db,
            userId,
            'GROUP_INVITATION',
            "You're invited",
            `You've been invited to ${alert.group_name}.`,
            { groupId: alert.group_id, invitationId: alert.invitation_id },
        );
    }
    await db.query('UPDATE pending_invitation_alerts SET delivered_to = $1 WHERE event_id = $2', [
        userId,
        alert.event_id,
    ]);
}

/**
 * Delivers invitations that were sent to this email before the account existed.
 * Called whenever the user opens their inbox.
 */
export async function deliverPendingAlerts(db: Db, userId: string, email: string): Promise<void> {
    const alerts = (
        await db.query(
            `SELECT * FROM pending_invitation_alerts
             WHERE email = $1 AND delivered_to IS NULL FOR UPDATE`,
            [email.trim().toLowerCase()],
        )
    ).rows;
    for (const alert of alerts) await deliverAlert(db, alert, userId);
}

async function invitationCreated(db: Db, event: InvitationCreatedEvent): Promise<void> {
    const alert = (
        await db.query(
            `INSERT INTO pending_invitation_alerts
                 (event_id, email, group_id, invitation_id, group_name, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [
                event.eventId,
                event.inviteeEmail,
                event.groupId,
                event.invitationId,
                event.groupName,
                new Date(event.expiresAt),
            ],
        )
    ).rows[0];
    const user = (await db.query('SELECT id FROM users WHERE email = $1', [event.inviteeEmail]))
        .rows[0];
    // Unregistered recipients keep the pending row until their first inbox request.
    if (user) await deliverAlert(db, alert, user.id);
}

// ---------------------------------------------------------- event handlers

async function titleFor(db: Db, groupId: string, action: string): Promise<string> {
    return `${(await groupName(db, groupId)) ?? 'Former group'} · ${action}`;
}

function participants(...snapshots: (ExpenseSnapshot | null)[]): Set<string> {
    const users = new Set<string>();
    for (const snapshot of snapshots) {
        if (!snapshot) continue;
        users.add(snapshot.paidBy);
        snapshot.shares.forEach((share) => users.add(share.userId));
    }
    return users;
}

/**
 * Everyone involved in the expense except the person who just made the change, who already
 * knows. Events written before actorId existed fall back to the payer, who is always the one
 * who adds, edits or deletes an expense.
 */
function recipients(
    actorId: string | undefined,
    ...snapshots: (ExpenseSnapshot | null)[]
): string[] {
    const actor = actorId ?? snapshots.find((snapshot) => snapshot)?.paidBy;
    return [...participants(...snapshots)].filter((userId) => userId !== actor);
}

async function expenseCreated(db: Db, event: ExpenseCreatedEvent): Promise<void> {
    const title = await titleFor(db, event.groupId, 'Expense added');
    for (const userId of recipients(event.actorId, event)) {
        await writeNotification(
            db,
            userId,
            'EXPENSE_CREATED',
            title,
            `${event.currency} ${event.amount} was added to your group expenses.`,
            { groupId: event.groupId, expenseId: event.expenseId },
        );
    }
}

async function expenseChanged(db: Db, event: ExpenseChangedEvent): Promise<void> {
    const removed = event.current === null;
    const title = await titleFor(db, event.groupId, removed ? 'Expense removed' : 'Expense updated');
    for (const userId of recipients(event.actorId, event.previous, event.current)) {
        await writeNotification(
            db,
            userId,
            removed ? 'EXPENSE_DELETED' : 'EXPENSE_UPDATED',
            title,
            removed
                ? 'A shared expense was removed. Your balance will update shortly.'
                : "A shared expense changed. Check your group's latest split.",
            { groupId: event.groupId, expenseId: event.expenseId },
        );
    }
}

async function settlementRecorded(db: Db, event: SettlementRecordedEvent): Promise<void> {
    await writeNotification(
        db,
        event.payeeId,
        'SETTLEMENT_RECORDED',
        await titleFor(db, event.groupId, 'Payment recorded'),
        `A ${event.currency} ${event.amount} payment was recorded for you.`,
        { groupId: event.groupId },
    );
}

const CONSUMER = 'notification-service';

export function registerNotificationConsumers(): void {
    subscribe(Topics.invitationCreated, CONSUMER, invitationCreated);
    subscribe(Topics.connectionAdded, CONSUMER, (db, event: ConnectionAddedEvent) =>
        writeNotification(
            db,
            event.recipientId,
            event.groupId === null ? 'FRIEND_ADDED' : 'GROUP_MEMBER_ADDED',
            event.groupId === null ? 'New friend' : 'Added to a group',
            connectionAddedMessage(event),
            { groupId: event.groupId },
        ),
    );
    subscribe(Topics.expenseCreated, CONSUMER, expenseCreated);
    subscribe(Topics.expenseChanged, CONSUMER, expenseChanged);
    subscribe(Topics.settlementRecorded, CONSUMER, settlementRecorded);
}

// ----------------------------------------------------------- push delivery

/** Data-only FCM message, so the device can reject a stale account's notification before display. */
async function sendPush(token: string, notification: any): Promise<void> {
    const data: Record<string, string> = {
        notificationId: notification.id,
        userId: notification.user_id,
        title: notification.title,
        message: notification.message,
        type: notification.type,
    };
    if (notification.group_id) data.groupId = notification.group_id;
    if (notification.invitation_id) data.invitationId = notification.invitation_id;
    if (notification.expense_id) data.expenseId = notification.expense_id;
    try {
        await getMessaging(firebaseApp()).send({ token, data, android: { priority: 'high' } });
    } catch (failure) {
        const code = (failure as { code?: unknown } | null)?.code;
        throw new Error(`Firebase push delivery failed: ${typeof code === 'string' ? code : 'unknown'}`);
    }
}

async function markDelivered(db: Db, deliveryId: string): Promise<void> {
    await db.query(
        'UPDATE push_deliveries SET delivered_at = $1, last_error = NULL WHERE id = $2',
        [new Date(), deliveryId],
    );
}

/** Backs off exponentially (capped at one hour) and gives up after ten attempts. */
async function scheduleRetry(db: Db, delivery: any, reason: string): Promise<void> {
    const attempts = delivery.attempts + 1;
    const delaySeconds = attempts >= 10 ? 365 * 24 * 60 * 60 : Math.min(3600, 2 ** attempts);
    await db.query(
        'UPDATE push_deliveries SET attempts = $1, last_error = $2, next_attempt_at = $3 WHERE id = $4',
        [
            attempts,
            (reason || 'Push provider failed').slice(0, 500),
            new Date(Date.now() + delaySeconds * 1000),
            delivery.id,
        ],
    );
}

async function dispatchPendingPushes(): Promise<void> {
    await tx(async (db) => {
        const deliveries = (
            await db.query(
                `SELECT * FROM push_deliveries
                 WHERE delivered_at IS NULL AND attempts < 10 AND next_attempt_at <= $1
                 ORDER BY next_attempt_at ASC
                 LIMIT 50 FOR UPDATE SKIP LOCKED`,
                [new Date()],
            )
        ).rows;
        for (const delivery of deliveries) {
            const preference = (
                await db.query('SELECT * FROM notification_preferences WHERE user_id = $1', [
                    delivery.user_id,
                ])
            ).rows[0];
            const notification = (
                await db.query('SELECT * FROM notifications WHERE id = $1', [
                    delivery.notification_id,
                ])
            ).rows[0];
            const token = preference?.push_enabled ? (preference.push_token ?? '').trim() : '';
            if (!token || !notification) {
                // Nothing to send any more; close the delivery.
                await markDelivered(db, delivery.id);
                continue;
            }
            try {
                await sendPush(token, notification);
                await markDelivered(db, delivery.id);
            } catch (error) {
                const reason = error instanceof Error ? error.message : 'Push provider failed';
                if (delivery.attempts === 0) {
                    logger.warn(`Push delivery ${delivery.id} will retry: ${reason}`);
                }
                await scheduleRetry(db, delivery, reason);
            }
        }
    });
}

let pushTimer: NodeJS.Timeout | undefined;
let pushStopped = true;

/** Starts the push dispatcher when PUSH_DELIVERY_ENABLED is true. */
export function startPushDispatcher(): void {
    if (!config.push.enabled) {
        logger.info('Push dispatcher disabled (PUSH_DELIVERY_ENABLED=false)');
        return;
    }
    logger.info('Firebase push dispatcher enabled');
    pushStopped = false;
    const tick = () => {
        dispatchPendingPushes()
            .catch((error) => logger.error('Push dispatch failed', error))
            .finally(() => {
                if (!pushStopped) pushTimer = setTimeout(tick, config.push.dispatchDelayMs);
            });
    };
    pushTimer = setTimeout(tick, config.push.dispatchDelayMs);
}

export function stopPushDispatcher(): void {
    pushStopped = true;
    if (pushTimer) clearTimeout(pushTimer);
}
