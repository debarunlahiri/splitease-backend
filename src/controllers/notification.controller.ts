import type { Request } from 'express';
import { db, Db, tx } from '../database';
import * as notifications from '../services/notification.service';
import { currentUser, pageRequest, uuidParam } from '../utils/http';
import { parseBody } from '../validators/common';
import { UpdatePreferences } from '../validators/notification.validator';

export const list = async (req: Request) => {
    const user = currentUser(req);
    const page = pageRequest(req);
    await tx((conn) => notifications.deliverPendingAlerts(conn, user.id, user.email));
    return notifications.listNotifications(db, user.id, page);
};

export const unreadCount = async (req: Request) => {
    const user = currentUser(req);
    await tx((conn) => notifications.deliverPendingAlerts(conn, user.id, user.email));
    return notifications.unreadCount(db, user.id);
};

export const getPreferences = (req: Request) => notifications.preferences(db, currentUser(req).id);

export const updatePreferences = (req: Request, conn: Db) =>
    notifications.updatePreferences(
        conn,
        currentUser(req).id,
        parseBody(UpdatePreferences, req.body),
    );

export const markRead = (req: Request, conn: Db) =>
    notifications.markRead(conn, currentUser(req).id, uuidParam(req, 'notificationId'));

export const markAllRead = async (req: Request, conn: Db) => {
    const user = currentUser(req);
    await notifications.deliverPendingAlerts(conn, user.id, user.email);
    await notifications.markAllRead(conn, user.id);
};
