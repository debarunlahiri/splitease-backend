import { Router } from 'express';
import { z } from 'zod';
import { db } from '../database';
import { idempotent } from '../middlewares/idempotency';
import * as friends from '../services/friend.service';
import { currentUser, pageRequest, route } from '../utils/http';
import { email, parseBody } from '../validators/common';
import { JoinLink } from '../validators/group.validator';

const EmailInvites = z.object({ emails: z.array(email).min(1).max(20) });

export const friendsRouter = Router();

friendsRouter.get(
    '/',
    route(200, (req) => friends.listFriends(db, currentUser(req).id, pageRequest(req))),
);
friendsRouter.post('/invitations', idempotent(201, (req, conn) => {
    const user = currentUser(req);
    const { emails } = parseBody(EmailInvites, req.body);
    return friends.inviteByEmail(conn, user.id, user.email, emails);
}));
friendsRouter.post(
    '/invite-links',
    idempotent(201, (req, conn) => friends.createFriendLink(conn, currentUser(req).id)),
);
friendsRouter.post('/invitations/accept', idempotent(200, (req, conn) => {
    const user = currentUser(req);
    const { token } = parseBody(JoinLink, req.body);
    return friends.acceptFriendInvite(conn, user.id, user.email, token);
}));
