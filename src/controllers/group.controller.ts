import type { Request } from 'express';
import { db, Db, tx } from '../database';
import * as groups from '../services/group.service';
import * as removal from '../services/member-removal.service';
import { currentUser, pageRequest, uuidParam } from '../utils/http';
import { parseBody } from '../validators/common';
import { AddContactMember, CreateGroup, Invite, InviteFriends, JoinLink, UpdateGroupSettings } from '../validators/group.validator';

// Handlers taking (req, conn) are idempotent writes and already run in a transaction.

export const create = (req: Request, conn: Db) =>
    groups.createGroup(conn, currentUser(req).id, parseBody(CreateGroup, req.body));

export const list = (req: Request) => groups.listGroups(db, currentUser(req).id, pageRequest(req));

export const detail = (req: Request) =>
    groups.groupDetail(db, currentUser(req).id, uuidParam(req, 'groupId'));

// Listing also marks overdue invitations EXPIRED, hence the transaction.
export const myInvitations = (req: Request) => {
    const user = currentUser(req);
    const page = pageRequest(req);
    return tx((conn) => groups.invitationInbox(conn, user.id, user.email, page));
};

export const groupInvitations = (req: Request) => {
    const userId = currentUser(req).id;
    const groupId = uuidParam(req, 'groupId');
    const page = pageRequest(req);
    return tx((conn) => groups.groupInvitations(conn, userId, groupId, page));
};

export const invite = (req: Request, conn: Db) => {
    const user = currentUser(req);
    return groups.createInvitation(
        conn,
        user.id,
        user.email,
        uuidParam(req, 'groupId'),
        parseBody(Invite, req.body),
    );
};

export const accept = (req: Request, conn: Db) => {
    const user = currentUser(req);
    return groups.acceptInvitation(conn, user.id, user.email, uuidParam(req, 'invitationId'));
};

export const inviteFriends = (req: Request, conn: Db) =>
    groups.inviteFriends(
        conn,
        currentUser(req).id,
        uuidParam(req, 'groupId'),
        parseBody(InviteFriends, req.body).friendIds,
    );

export const resend = (req: Request, conn: Db) =>
    groups.resendInvitation(conn, currentUser(req).id, uuidParam(req, 'invitationId'));

export const decline = (req: Request, conn: Db) => {
    const user = currentUser(req);
    return groups.declineInvitation(conn, user.id, user.email, uuidParam(req, 'invitationId'));
};

export const revoke = (req: Request, conn: Db) =>
    groups.revokeInvitation(conn, currentUser(req).id, uuidParam(req, 'invitationId'));

export const createInviteLink = (req: Request) => {
    const userId = currentUser(req).id;
    const groupId = uuidParam(req, 'groupId');
    return tx((conn) => groups.createInviteLink(conn, userId, groupId));
};

export const joinInviteLink = (req: Request) => {
    const userId = currentUser(req).id;
    const { token } = parseBody(JoinLink, req.body);
    return tx((conn) => groups.joinByInviteLink(conn, userId, token));
};

export const addContact = (req: Request, conn: Db) =>
    groups.addContactMember(
        conn,
        currentUser(req).id,
        uuidParam(req, 'groupId'),
        parseBody(AddContactMember, req.body),
    );

export const memberUsage = (req: Request) =>
    removal.memberUsage(db, currentUser(req).id, uuidParam(req, 'groupId'), uuidParam(req, 'memberId'));

export const removeMember = async (req: Request, conn: Db) => {
    await removal.removeMember(conn, currentUser(req).id, uuidParam(req, 'groupId'), uuidParam(req, 'memberId'), req.query.adjust === 'true');
};

export const updateSettings = (req: Request, conn: Db) =>
    groups.updateGroupSettings(
        conn,
        currentUser(req).id,
        uuidParam(req, 'groupId'),
        parseBody(UpdateGroupSettings, req.body),
    );
