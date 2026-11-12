import { Router } from 'express';
import * as groups from '../controllers/group.controller';
import { idempotent } from '../middlewares/idempotency';
import { db } from '../database';
import { progress } from '../services/ledger.service';
import { currentUser, route } from '../utils/http';

export const groupsRouter = Router();

// Fixed paths come before '/:groupId' so they are not read as a group id.
groupsRouter.post('/', idempotent(201, groups.create));
groupsRouter.get('/', route(200, groups.list));
groupsRouter.get('/progress', route(200, (req) => progress(db, currentUser(req).id)));
groupsRouter.get('/invitations/me', route(200, groups.myInvitations));
groupsRouter.post('/invitations/:invitationId/accept', idempotent(200, groups.accept));
groupsRouter.post('/invitations/:invitationId/decline', idempotent(200, groups.decline));
groupsRouter.post('/invitations/:invitationId/revoke', idempotent(200, groups.revoke));
groupsRouter.post('/invitations/:invitationId/resend', idempotent(200, groups.resend));
groupsRouter.post('/invite-links/join', route(200, groups.joinInviteLink));

groupsRouter.get('/:groupId', route(200, groups.detail));
groupsRouter.post('/:groupId/invitations', idempotent(201, groups.invite));
groupsRouter.post('/:groupId/invitations/friends', idempotent(201, groups.inviteFriends));
groupsRouter.post('/:groupId/contacts', idempotent(201, groups.addContact));
groupsRouter.get('/:groupId/invitations', route(200, groups.groupInvitations));
groupsRouter.post('/:groupId/invite-links', route(201, groups.createInviteLink));
