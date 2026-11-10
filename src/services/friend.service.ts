import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { advisoryLock, Db } from '../database';
import { appendEvent } from '../events/outbox';
import { ConnectionAddedEvent, Topics } from '../events/types';
import { conflict, forbidden, notFound, tooManyRequests } from '../utils/errors';
import { PageRequest, pageResponse } from '../utils/http';
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
