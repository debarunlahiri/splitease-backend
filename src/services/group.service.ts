import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { advisoryLock, Db } from '../database';
import { conflict, forbidden, notFound, tooManyRequests } from '../utils/errors';
import { PageRequest, PageResponse, pageResponse } from '../utils/http';
import { generateToken, sha256Hex } from '../utils/tokens';
import { appendEvent } from '../events/outbox';
import { ConnectionAddedEvent, InvitationCreatedEvent, Topics } from '../events/types';
import { invitationEmail, queueMail } from './mail.service';

interface GroupRow {
    id: string;
    name: string;
    default_currency: string;
    created_by: string;
    created_at: Date;
    invoices_enabled?: boolean;
}

export interface MemberView {
    userId: string;
    role: string;
    joinedAt: Date;
    displayName: string | null;
    photoUrl: string | null;
    /** Added from contacts and not on SplitEase yet. */
    pending?: boolean;
    upiId?: string | null;
    upiVerified?: boolean;
    /** The phone number of a contact you added yourself; never shown to other members. */
    contactPhone?: string | null;
}

export interface GroupView {
    id: string;
    /** Whether invoices and receipts can be issued for this group's pay links. */
    invoicesEnabled: boolean;
    name: string;
    defaultCurrency: string;
    createdBy: string;
    createdAt: Date;
    members: MemberView[];
}

export interface InvitationView {
    id: string;
    groupId: string;
    inviteeUserId: string | null;
    invitedBy: string;
    status: string;
    createdAt: Date;
    expiresAt: Date;
    respondedAt: Date | null;
    inviteeEmail: string | null;
}

type ListedInvitationView = InvitationView & { groupName: string };

// ------------------------------------------------- membership (used by other modules)

export async function requiredGroup(db: Db, groupId: string): Promise<GroupRow> {
    const group = (await db.query('SELECT * FROM expense_groups WHERE id = $1', [groupId])).rows[0];
    if (!group) throw notFound('Group not found');
    return group;
}

/** The ids of every member; 404 when the group does not exist. */
export async function memberIds(db: Db, groupId: string): Promise<Set<string>> {
    await requiredGroup(db, groupId);
    const rows = (
        await db.query('SELECT user_id FROM group_members WHERE group_id = $1', [groupId])
    ).rows;
    return new Set<string>(rows.map((row) => row.user_id));
}

export async function requireMember(db: Db, groupId: string, userId: string): Promise<void> {
    if (!(await memberIds(db, groupId)).has(userId)) {
        throw forbidden('User is not a member of this group');
    }
}

export async function requireMembers(
    db: Db,
    groupId: string,
    userIds: string[],
    message: string,
): Promise<void> {
    const members = await memberIds(db, groupId);
    if (!userIds.every((userId) => members.has(userId))) throw forbidden(message);
}

/** The group's name, or null when it no longer exists. */
export async function groupName(db: Db, groupId: string): Promise<string | null> {
    const row = (await db.query('SELECT name FROM expense_groups WHERE id = $1', [groupId])).rows[0];
    return row ? row.name : null;
}

async function addMember(db: Db, groupId: string, userId: string, role: string): Promise<boolean> {
    // Membership is unique per group and user, so repeating this is harmless.
    const result = await db.query(
        `INSERT INTO group_members (id, group_id, user_id, role, joined_at)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (group_id, user_id) DO NOTHING`,
        [randomUUID(), groupId, userId, role, new Date()],
    );
    return result.rowCount === 1;
}

/**
 * Adds a person from the caller's contacts to the group so they can be part of splits right away.
 * They have no login; when they later accept an email invitation, their splits move to their account.
 */
export async function addContactMember(
    db: Db,
    userId: string,
    groupId: string,
    input: { name: string; email?: string | null; phone?: string | null },
): Promise<MemberView> {
    await requireMember(db, groupId, userId);
    const email = input.email ? input.email.trim().toLowerCase() : null;
    const phone = input.phone ? input.phone.replace(/[^\d+]/g, '') || null : null;
    const existing = (
        await db.query(
            `SELECT u.id FROM users u JOIN group_members m ON m.user_id = u.id
             WHERE m.group_id = $1 AND u.is_contact
               AND (($2::text IS NOT NULL AND lower(u.contact_email) = $2)
                 OR ($3::text IS NOT NULL AND u.contact_phone = $3))`,
            [groupId, email, phone],
        )
    ).rows[0];
    let contactId: string = existing?.id;
    if (!contactId) {
        contactId = randomUUID();
        await db.query(
            `INSERT INTO users (id, email, display_name, password_hash, created_at,
                                is_contact, contact_email, contact_phone, added_by)
             VALUES ($1, $2, $3, '!', $4, TRUE, $5, $6, $7)`,
            [
                contactId,
                `contact-${contactId}@placeholder.invalid`,
                input.name.trim().slice(0, 100),
                new Date(),
                email,
                phone,
                userId,
            ],
        );
        await addMember(db, groupId, contactId, 'CONTACT');
    }
    const member = (
        await db.query(
            `SELECT m.user_id, m.role, m.joined_at, u.display_name, u.photo_url
             FROM group_members m JOIN users u ON u.id = m.user_id
             WHERE m.group_id = $1 AND m.user_id = $2`,
            [groupId, contactId],
        )
    ).rows[0];
    return {
        userId: member.user_id,
        role: member.role,
        joinedAt: member.joined_at,
        displayName: member.display_name,
        photoUrl: member.photo_url ?? null,
        pending: true,
    };
}

/** Moves a contact's splits onto the real account of the same email when that person joins. */
async function claimContactMembers(db: Db, groupId: string, realUserId: string, email: string): Promise<void> {
    const contacts = (
        await db.query(
            `SELECT u.id FROM users u JOIN group_members m ON m.user_id = u.id
             WHERE m.group_id = $1 AND u.is_contact AND lower(u.contact_email) = lower($2)`,
            [groupId, email],
        )
    ).rows;
    for (const { id } of contacts) {
        await db.query(
            `UPDATE expense_shares SET user_id = $1
             WHERE user_id = $2 AND expense_id IN (SELECT id FROM expenses WHERE group_id = $3)
               AND NOT EXISTS (SELECT 1 FROM expense_shares x WHERE x.expense_id = expense_shares.expense_id AND x.user_id = $1)`,
            [realUserId, id, groupId],
        );
        // Open payment claims made through a pay link follow the person to their new account.
        await db.query('UPDATE expense_payment_claims SET user_id = $1 WHERE user_id = $2 AND group_id = $3', [realUserId, id, groupId]);
        await db.query('UPDATE settlements SET payer_id = $1 WHERE payer_id = $2 AND group_id = $3', [realUserId, id, groupId]);
        await db.query('UPDATE settlements SET payee_id = $1 WHERE payee_id = $2 AND group_id = $3', [realUserId, id, groupId]);
        await db.query(
            `INSERT INTO group_balances (id, group_id, user_id, currency, amount, updated_at)
             SELECT gen_random_uuid(), group_id, $1, currency, amount, now() FROM group_balances
             WHERE group_id = $3 AND user_id = $2
             ON CONFLICT (group_id, user_id, currency)
             DO UPDATE SET amount = group_balances.amount + EXCLUDED.amount, updated_at = now()`,
            [realUserId, id, groupId],
        );
        await db.query('DELETE FROM group_balances WHERE group_id = $1 AND user_id = $2', [groupId, id]);
        await db.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, id]);
        // The placeholder account goes away once nothing refers to it any more.
        const left = (await db.query('SELECT 1 FROM group_members WHERE user_id = $1 LIMIT 1', [id])).rowCount;
        if (!left) await db.query('DELETE FROM users WHERE id = $1 AND is_contact', [id]);
    }
}

async function addInvitedMember(
    db: Db,
    group: GroupRow,
    userId: string,
    inviterId: string,
): Promise<void> {
    if (!(await addMember(db, group.id, userId, 'MEMBER'))) return;
    const inviter = (await db.query('SELECT display_name FROM users WHERE id = $1', [inviterId]))
        .rows[0];
    const event: ConnectionAddedEvent = {
        eventId: randomUUID(),
        actorName: inviter?.display_name ?? 'A group owner',
        recipientId: userId,
        groupId: group.id,
        groupName: group.name,
    };
    await appendEvent(db, Topics.connectionAdded, 'ConnectionAddedEvent', group.id, userId, event);
}

// ------------------------------------------------------------------ groups

async function groupViews(db: Db, groups: GroupRow[], viewerId?: string): Promise<GroupView[]> {
    if (groups.length === 0) return [];
    const members = (
        await db.query(
            `SELECT m.group_id, m.user_id, m.role, m.joined_at, u.display_name, u.photo_url, u.is_contact, u.upi_id, u.upi_verified_at,
                    u.contact_phone, u.added_by
             FROM group_members m LEFT JOIN users u ON u.id = m.user_id
             WHERE m.group_id = ANY($1::uuid[])
             ORDER BY m.joined_at ASC, m.id ASC`,
            [groups.map((group) => group.id)],
        )
    ).rows;
    return groups.map((group) => ({
        id: group.id,
        name: group.name,
        defaultCurrency: group.default_currency,
        createdBy: group.created_by,
        createdAt: group.created_at,
        invoicesEnabled: group.invoices_enabled !== false,
        members: members
            .filter((member) => member.group_id === group.id)
            .map((member) => ({
                userId: member.user_id,
                role: member.role,
                joinedAt: member.joined_at,
                displayName: member.display_name ?? null,
                photoUrl: member.photo_url ?? null,
                /** Added from contacts and not on SplitEase yet. */
                pending: Boolean(member.is_contact),
                /** UPI ID for paying this person back (INR). */
                upiId: member.upi_id ?? null,
                upiVerified: Boolean(member.upi_id && member.upi_verified_at),
                contactPhone: member.is_contact && viewerId && member.added_by === viewerId ? (member.contact_phone ?? null) : null,
            })),
    }));
}

export async function createGroup(
    db: Db,
    userId: string,
    input: { name: string; defaultCurrency: string },
): Promise<GroupView> {
    const group: GroupRow = (
        await db.query(
            `INSERT INTO expense_groups (id, name, default_currency, created_by, created_at)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [randomUUID(), input.name.trim(), input.defaultCurrency, userId, new Date()],
        )
    ).rows[0];
    await addMember(db, group.id, userId, 'OWNER');
    return (await groupViews(db, [group], userId))[0];
}

export async function listGroups(
    db: Db,
    userId: string,
    page: PageRequest,
): Promise<PageResponse<GroupView>> {
    const membership = 'EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.user_id = $1)';
    const total = (
        await db.query(`SELECT COUNT(*) AS total FROM expense_groups g WHERE ${membership}`, [userId])
    ).rows[0].total;
    const groups = (
        await db.query(
            `SELECT g.* FROM expense_groups g WHERE ${membership}
             ORDER BY g.created_at DESC, g.id DESC LIMIT $2 OFFSET $3`,
            [userId, page.size, page.offset],
        )
    ).rows;
    return pageResponse(await groupViews(db, groups, userId), page, total);
}

export async function groupDetail(db: Db, userId: string, groupId: string): Promise<GroupView> {
    const view = (await groupViews(db, [await requiredGroup(db, groupId)], userId))[0];
    if (!view.members.some((member) => member.userId === userId)) {
        throw forbidden('Group membership required');
    }
    return view;
}

// ------------------------------------------------------------- invitations

function invitationView(row: any): InvitationView {
    return {
        id: row.id,
        groupId: row.group_id,
        inviteeUserId: row.invitee_user_id,
        invitedBy: row.invited_by,
        status: row.status,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        respondedAt: row.responded_at,
        inviteeEmail: row.invitee_email,
    };
}

function normalizeEmail(email: string | null | undefined): string {
    if (!email || email.trim() === '') throw forbidden('An authenticated email is required');
    return email.trim().toLowerCase();
}

/** Invitations and invite links of one group are changed one transaction at a time. */
function lockGroup(db: Db, groupId: string): Promise<void> {
    return advisoryLock(db, `group-invitations:${groupId}`);
}

function requireOwner(group: GroupRow, userId: string): void {
    if (group.created_by !== userId) {
        throw forbidden('Only the group owner can manage invitations');
    }
}

/** Loads an invitation for update, holding its group's lock. */
async function requiredInvitation(db: Db, invitationId: string): Promise<any> {
    const current = (
        await db.query('SELECT group_id FROM group_invitations WHERE id = $1', [invitationId])
    ).rows[0];
    if (!current) throw notFound('Invitation not found');
    await lockGroup(db, current.group_id);
    const locked = (
        await db.query('SELECT * FROM group_invitations WHERE id = $1 FOR UPDATE', [invitationId])
    ).rows[0];
    if (!locked) throw notFound('Invitation not found');
    return locked;
}

function isExpired(invitation: any, now: Date): boolean {
    return invitation.status === 'PENDING' && invitation.expires_at.getTime() <= now.getTime();
}

function requirePending(invitation: any): void {
    if (isExpired(invitation, new Date())) throw conflict('Invitation has expired');
    if (invitation.status !== 'PENDING') throw conflict('Invitation is no longer pending');
}

function requireInvitee(invitation: any, userId: string, email: string): void {
    const ownsLegacyInvitation = invitation.invitee_user_id === userId;
    const ownsEmailInvitation =
        invitation.invitee_user_id === null && normalizeEmail(email) === invitation.invitee_email;
    if (!ownsLegacyInvitation && !ownsEmailInvitation) {
        throw forbidden('Only the invited user can respond');
    }
}

async function respond(
    db: Db,
    invitationId: string,
    status: 'ACCEPTED' | 'DECLINED' | 'REVOKED',
    inviteeUserId: string | null,
): Promise<InvitationView> {
    const row = (
        await db.query(
            `UPDATE group_invitations
             SET status = $1, responded_at = $2, version = version + 1,
                 invitee_user_id = COALESCE($3, invitee_user_id)
             WHERE id = $4 RETURNING *`,
            [status, new Date(), inviteeUserId, invitationId],
        )
    ).rows[0];
    return invitationView(row);
}

export async function createInvitation(
    db: Db,
    ownerId: string,
    ownerEmail: string,
    groupId: string,
    input: { email: string },
): Promise<InvitationView> {
    await lockGroup(db, groupId);
    const group = await requiredGroup(db, groupId);
    requireOwner(group, ownerId);
    const email = normalizeEmail(input.email);
    if (email === normalizeEmail(ownerEmail)) {
        throw conflict('You already belong to this group');
    }
    const invitation = await createPendingInvitation(db, group, ownerId, email);
    if (!invitation) throw conflict('A pending invitation already exists');
    return invitation;
}

export async function inviteFriends(
    db: Db,
    ownerId: string,
    groupId: string,
    friendIds: string[],
): Promise<{ invited: number }> {
    await lockGroup(db, groupId);
    const group = await requiredGroup(db, groupId);
    requireOwner(group, ownerId);
    const ids = [...new Set(friendIds)];
    const friends: { id: string; email: string }[] = (
        await db.query(
            `SELECT u.id, u.email FROM users u
             JOIN friendships f ON f.first_user_id = LEAST(u.id, $1::uuid)
                               AND f.second_user_id = GREATEST(u.id, $1::uuid)
             WHERE u.id = ANY($2::uuid[])`,
            [ownerId, ids],
        )
    ).rows;
    if (friends.length !== ids.length) throw forbidden('Only accepted friends can be invited here');

    const members: { user_id: string }[] = (
        await db.query('SELECT user_id FROM group_members WHERE group_id = $1', [
            groupId,
        ])
    ).rows;
    const memberIds = new Set(members.map((member) => member.user_id));
    let invited = 0;
    for (const friend of friends) {
        if (memberIds.has(friend.id)) continue;
        const invitation = await createPendingInvitation(db, group, ownerId, friend.email, friend.id);
        if (invitation) invited++;
    }
    return { invited };
}

async function createPendingInvitation(
    db: Db,
    group: GroupRow,
    ownerId: string,
    email: string,
    inviteeId: string | null = null,
): Promise<InvitationView | null> {
    const groupId = group.id;
    const now = new Date();
    const existing = (
        await db.query(
            `SELECT * FROM group_invitations
             WHERE group_id = $1 AND (invitee_email = $2 OR invitee_user_id = $3)
                 AND status = 'PENDING' FOR UPDATE`,
            [groupId, email, inviteeId],
        )
    ).rows;
    if (existing.some((row) => !isExpired(row, now))) return null;
    if (existing.length > 0) {
        await db.query(
            `UPDATE group_invitations
             SET status = 'EXPIRED', responded_at = $1, version = version + 1
             WHERE id = ANY($2::uuid[])`,
            [now, existing.map((row) => row.id)],
        );
    }
    const invitation = (
        await db.query(
            `INSERT INTO group_invitations
                 (id, group_id, invitee_email, invitee_user_id, invited_by, status, created_at, expires_at,
                  last_sent_at)
             VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, $7, $6) RETURNING *`,
            [
                randomUUID(),
                groupId,
                email,
                inviteeId,
                ownerId,
                now,
                new Date(now.getTime() + config.groups.invitationLifetimeMs),
            ],
        )
    ).rows[0];
    const event: InvitationCreatedEvent = {
        eventId: randomUUID(),
        invitationId: invitation.id,
        groupId,
        groupName: group.name,
        inviteeEmail: email,
        invitedBy: ownerId,
        expiresAt: invitation.expires_at.toISOString(),
        occurredAt: now.toISOString(),
    };
    await appendEvent(db, Topics.invitationCreated, 'InvitationCreatedEvent', groupId, invitation.id, event);
    return invitationView(invitation);
}

/** Lists invitations matching `filter`, first marking the overdue ones EXPIRED. */
async function invitationPage(
    db: Db,
    filter: string,
    params: unknown[],
    page: PageRequest,
): Promise<PageResponse<ListedInvitationView>> {
    await db.query(
        `UPDATE group_invitations i
         SET status = 'EXPIRED', responded_at = $${params.length + 1}, version = version + 1
         WHERE i.status = 'PENDING' AND i.expires_at <= $${params.length + 1} AND (${filter})`,
        [...params, new Date()],
    );
    const total = (
        await db.query(`SELECT COUNT(*) AS total FROM group_invitations i WHERE ${filter}`, params)
    ).rows[0].total;
    const rows = (
        await db.query(
            `SELECT i.*, g.name AS group_name
             FROM group_invitations i
             JOIN expense_groups g ON g.id = i.group_id
             WHERE ${filter}
             ORDER BY i.created_at DESC, i.id DESC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, page.size, page.offset],
        )
    ).rows;
    const invitations = rows.map((row): ListedInvitationView => ({
        ...invitationView(row),
        groupName: row.group_name,
    }));
    return pageResponse(invitations, page, total);
}

/** Invitations addressed to the caller, by account or by email. */
export function invitationInbox(
    db: Db,
    userId: string,
    email: string,
    page: PageRequest,
): Promise<PageResponse<ListedInvitationView>> {
    return invitationPage(
        db,
        'i.invitee_user_id = $1 OR (i.invitee_user_id IS NULL AND i.invitee_email = $2)',
        [userId, normalizeEmail(email)],
        page,
    );
}

export async function groupInvitations(
    db: Db,
    ownerId: string,
    groupId: string,
    page: PageRequest,
): Promise<PageResponse<ListedInvitationView>> {
    requireOwner(await requiredGroup(db, groupId), ownerId);
    return invitationPage(db, 'i.group_id = $1', [groupId], page);
}

export async function acceptInvitation(
    db: Db,
    userId: string,
    email: string,
    invitationId: string,
): Promise<InvitationView> {
    const invitation = await requiredInvitation(db, invitationId);
    requireInvitee(invitation, userId, email);
    requirePending(invitation);
    if ((await memberIds(db, invitation.group_id)).has(userId)) {
        throw conflict('User is already a group member');
    }
    const group = await requiredGroup(db, invitation.group_id);
    await addInvitedMember(db, group, userId, invitation.invited_by);
    await claimContactMembers(db, invitation.group_id, userId, email);
    return respond(db, invitationId, 'ACCEPTED', userId);
}

export async function declineInvitation(
    db: Db,
    userId: string,
    email: string,
    invitationId: string,
): Promise<InvitationView> {
    const invitation = await requiredInvitation(db, invitationId);
    requireInvitee(invitation, userId, email);
    requirePending(invitation);
    return respond(db, invitationId, 'DECLINED', userId);
}

export async function revokeInvitation(
    db: Db,
    ownerId: string,
    invitationId: string,
): Promise<InvitationView> {
    const invitation = await requiredInvitation(db, invitationId);
    requireOwner(await requiredGroup(db, invitation.group_id), ownerId);
    requirePending(invitation);
    return respond(db, invitationId, 'REVOKED', null);
}

/** Minimum time between two emails for the same invitation. */
const RESEND_COOLDOWN_MS = 60_000;

/**
 * Sends a pending email invitation again and gives it a fresh expiry window. The invitee
 * is not notified in the app a second time; only the email is repeated.
 */
export async function resendInvitation(
    db: Db,
    ownerId: string,
    invitationId: string,
): Promise<InvitationView> {
    const invitation = await requiredInvitation(db, invitationId);
    const group = await requiredGroup(db, invitation.group_id);
    requireOwner(group, ownerId);
    requirePending(invitation);
    if (!invitation.invitee_email) {
        throw conflict('This invitation has no email address to send to');
    }
    const now = new Date();
    const lastSent: Date = invitation.last_sent_at ?? invitation.created_at;
    if (now.getTime() - lastSent.getTime() < RESEND_COOLDOWN_MS) {
        throw tooManyRequests('Please wait a minute before sending this invitation again');
    }
    const updated = (
        await db.query(
            `UPDATE group_invitations
             SET expires_at = $1, last_sent_at = $2, version = version + 1
             WHERE id = $3 RETURNING *`,
            [new Date(now.getTime() + config.groups.invitationLifetimeMs), now, invitationId],
        )
    ).rows[0];
    const inviter = (await db.query('SELECT display_name FROM users WHERE id = $1', [ownerId]))
        .rows[0];
    await queueMail(
        db,
        invitationEmail(
            updated.invitee_email,
            group.name,
            inviter ? inviter.display_name : null,
            updated.expires_at,
        ),
        'invitation',
    );
    return invitationView(updated);
}

// ------------------------------------------------------------ invite links

export async function createInviteLink(
    db: Db,
    userId: string,
    groupId: string,
): Promise<{ token: string; expiresAt: Date; url: string }> {
    const group = await requiredGroup(db, groupId);
    if (group.created_by !== userId) {
        throw forbidden('Only the group owner can create invite links');
    }
    const token = generateToken();
    const expiresAt = new Date(Date.now() + config.groups.inviteLinkLifetimeMs);
    await db.query(
        'INSERT INTO group_invite_links (id, group_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
        [randomUUID(), groupId, sha256Hex(token), expiresAt],
    );
    // The link to share points at the website (first APP_URL entry). The token stays in the
    // #fragment, so it is never sent to a server or logged.
    return { token, expiresAt, url: `${config.appUrls[0]}/join#${token}` };
}

/** Anyone holding a valid link can join; reopening it never duplicates membership. */
export async function joinByInviteLink(
    db: Db,
    userId: string,
    token: string,
): Promise<{ groupId: string }> {
    const link = (
        await db.query('SELECT * FROM group_invite_links WHERE token_hash = $1', [sha256Hex(token)])
    ).rows[0];
    if (!link) throw notFound('Invite link not found');
    await lockGroup(db, link.group_id);
    if (link.expires_at.getTime() <= Date.now()) throw conflict('Invite link has expired');
    const group = await requiredGroup(db, link.group_id);
    await addInvitedMember(db, group, userId, group.created_by);
    return { groupId: group.id };
}

/** The group's creator turns invoices and receipts on or off for the group. */
export async function updateGroupSettings(
    db: Db,
    userId: string,
    groupId: string,
    input: { invoicesEnabled: boolean },
): Promise<GroupView> {
    const group = await requiredGroup(db, groupId);
    if (group.created_by !== userId) throw forbidden('Only the person who created this group can change its settings');
    await db.query('UPDATE expense_groups SET invoices_enabled = $1 WHERE id = $2', [input.invoicesEnabled, groupId]);
    return groupDetail(db, userId, groupId);
}
