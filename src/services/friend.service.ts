import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { advisoryLock, Db } from '../database';
import { appendEvent } from '../events/outbox';
import { ConnectionAddedEvent, Topics } from '../events/types';
import { conflict, forbidden, notFound, tooManyRequests } from '../utils/errors';
import { PageRequest, pageResponse } from '../utils/http';
import { toJsonNumber } from '../utils/money';
import { generateToken, sha256Hex } from '../utils/tokens';
import { friendInvitationEmail, queueMail } from './mail.service';

export async function listFriends(db: Db, userId: string, page: PageRequest) {
    const friends = `
        FROM friendships f
        JOIN users u ON u.id = CASE
            WHEN f.first_user_id = $1 THEN f.second_user_id ELSE f.first_user_id END
        WHERE f.first_user_id = $1 OR f.second_user_id = $1`;
    const total = (await db.query(`SELECT COUNT(*) AS total ${friends}`, [userId])).rows[0].total;
    const rows = (
        await db.query(
            `SELECT u.id, u.display_name AS "displayName", u.photo_url AS "photoUrl" ${friends}
             ORDER BY u.display_name, u.id LIMIT $2 OFFSET $3`,
            [userId, page.size, page.offset],
        )
    ).rows;
    return pageResponse(rows, page, total);
}

/** Ends a friendship. Splits you already share are not touched. */
export async function removeFriend(db: Db, userId: string, friendId: string): Promise<void> {
    const [first, second] = userId < friendId ? [userId, friendId] : [friendId, userId];
    const result = await db.query('DELETE FROM friendships WHERE first_user_id = $1 AND second_user_id = $2', [first, second]);
    if (result.rowCount === 0) throw notFound('This person is not in your friends');
}

async function checkInviteLimit(db: Db, userId: string, count: number): Promise<void> {
    await advisoryLock(db, `friend-invites:${userId}`);
    const recent = (
        await db.query(
            `SELECT COUNT(*) AS total FROM friend_invites
             WHERE inviter_id = $1 AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 day'`,
            [userId],
        )
    ).rows[0].total;
    if (Number(recent) + count > 50) throw tooManyRequests('Daily friend invitation limit reached');
}

async function createInvite(db: Db, userId: string, email: string | null): Promise<string> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    await db.query(
        `INSERT INTO friend_invites (id, inviter_id, invitee_email, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), userId, email, sha256Hex(token), expiresAt],
    );
    return `${config.appUrls[0]}/friend#${token}`;
}

export async function inviteByEmail(db: Db, userId: string, ownEmail: string, emails: string[]) {
    const recipients = [...new Set(emails.map((email) => email.toLowerCase()))].filter(
        (email) => email !== ownEmail.toLowerCase(),
    );
    await checkInviteLimit(db, userId, recipients.length);
    const inviter = (
        await db.query('SELECT display_name FROM users WHERE id = $1', [userId])
    ).rows[0];
    for (const email of recipients) {
        const url = await createInvite(db, userId, email);
        await queueMail(db, friendInvitationEmail(email, inviter.display_name, url), 'friend-invite');
    }
    return { invited: recipients.length };
}

export async function createFriendLink(db: Db, userId: string) {
    await checkInviteLimit(db, userId, 1);
    return { inviteUrl: await createInvite(db, userId, null) };
}

export async function acceptFriendInvite(db: Db, userId: string, email: string, token: string) {
    const invite = (
        await db.query(
            `SELECT i.inviter_id, i.invitee_email, i.expires_at, u.display_name
             FROM friend_invites i JOIN users u ON u.id = i.inviter_id
             WHERE i.token_hash = $1`,
            [sha256Hex(token)],
        )
    ).rows[0];
    if (!invite) throw notFound('Friend invitation not found');
    if (invite.invitee_email !== null && invite.invitee_email !== email.toLowerCase()) {
        throw forbidden('This invitation belongs to a different email address');
    }
    if (invite.inviter_id === userId) throw conflict('You cannot accept your own invitation');
    if (invite.expires_at.getTime() <= Date.now()) throw conflict('Friend invitation has expired');

    const inserted = await db.query(
        `INSERT INTO friendships (first_user_id, second_user_id)
         VALUES (LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid))
         ON CONFLICT DO NOTHING`,
        [userId, invite.inviter_id],
    );
    if (inserted.rowCount === 1) {
        const event: ConnectionAddedEvent = {
            eventId: randomUUID(),
            actorName: invite.display_name,
            recipientId: userId,
            groupId: null,
            groupName: null,
        };
        await appendEvent(db, Topics.connectionAdded, 'ConnectionAddedEvent', userId, userId, event);
    }
    return { friendId: invite.inviter_id };
}

export interface FriendMoney {
    currency: string;
    /** Positive: they owe you. Negative: you owe them. */
    amount: number;
}

/** Everything you share with one friend: Splits you are both in, the splits between you, and who owes whom. */
export async function friendOverview(db: Db, userId: string, friendId: string) {
    const person = (
        await db.query(
            `SELECT id, display_name AS "displayName", photo_url AS "photoUrl" FROM users WHERE id = $1`,
            [friendId],
        )
    ).rows[0];
    if (!person) throw notFound('Friend not found');
    const [first, second] = userId < friendId ? [userId, friendId] : [friendId, userId];
    const isFriend = (
        await db.query(`SELECT 1 FROM friendships WHERE first_user_id = $1 AND second_user_id = $2`, [first, second])
    ).rowCount;

    const groups = (
        await db.query(
            `SELECT g.id, g.name, g.default_currency AS currency
             FROM expense_groups g
             JOIN group_members a ON a.group_id = g.id AND a.user_id = $1
             JOIN group_members b ON b.group_id = g.id AND b.user_id = $2
             ORDER BY g.name`,
            [userId, friendId],
        )
    ).rows;
    if (!isFriend && groups.length === 0) throw notFound('Friend not found');

    const expenses = (
        await db.query(
            `SELECT e.id, e.group_id, g.name AS group_name, e.description, e.amount, e.currency, e.expense_date,
                    e.paid_by, p.display_name AS paid_by_name,
                    sm.amount AS my_share, sm.paid_amount AS my_paid, sf.amount AS their_share, sf.paid_amount AS their_paid
             FROM expenses e
             JOIN expense_groups g ON g.id = e.group_id
             JOIN users p ON p.id = e.paid_by
             LEFT JOIN expense_shares sm ON sm.expense_id = e.id AND sm.user_id = $1
             LEFT JOIN expense_shares sf ON sf.expense_id = e.id AND sf.user_id = $2
             WHERE e.deleted_at IS NULL AND (
                   (e.paid_by = $1 AND sf.amount > 0)
                OR (e.paid_by = $2 AND sm.amount > 0)
                OR (sm.amount > 0 AND sf.amount > 0))
             ORDER BY e.expense_date DESC, e.created_at DESC`,
            [userId, friendId],
        )
    ).rows;

    const totals = new Map<string, number>();
    const perGroup = new Map<string, Map<string, number>>();
    const list = expenses.map((row) => {
        // Positive: the friend still owes you for this one. Negative: you still owe the friend.
        let outstanding = 0;
        if (row.paid_by === userId) outstanding = toJsonNumber(row.their_share) - toJsonNumber(row.their_paid);
        else if (row.paid_by === friendId) outstanding = -(toJsonNumber(row.my_share) - toJsonNumber(row.my_paid));
        if (outstanding !== 0) {
            totals.set(row.currency, (totals.get(row.currency) ?? 0) + outstanding);
            const groupTotals = perGroup.get(row.group_id) ?? new Map<string, number>();
            groupTotals.set(row.currency, (groupTotals.get(row.currency) ?? 0) + outstanding);
            perGroup.set(row.group_id, groupTotals);
        }
        return {
            id: row.id,
            groupId: row.group_id,
            groupName: row.group_name,
            description: row.description,
            amount: toJsonNumber(row.amount),
            currency: row.currency,
            date: row.expense_date instanceof Date ? row.expense_date.toISOString().slice(0, 10) : String(row.expense_date).slice(0, 10),
            paidBy: row.paid_by === userId ? 'YOU' : row.paid_by === friendId ? 'FRIEND' : 'OTHER',
            paidByName: row.paid_by_name,
            yourShare: toJsonNumber(row.my_share ?? 0),
            theirShare: toJsonNumber(row.their_share ?? 0),
            outstanding,
        };
    });
    const money = (map: Map<string, number>): FriendMoney[] =>
        [...map].map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 })).filter((m) => m.amount !== 0);

    return {
        friend: { ...person, isFriend: Boolean(isFriend) },
        balance: money(totals),
        groups: groups.map((g) => ({ id: g.id, name: g.name, currency: g.currency, balance: money(perGroup.get(g.id) ?? new Map()) })),
        expenses: list.slice(0, 100),
        expenseCount: list.length,
    };
}
