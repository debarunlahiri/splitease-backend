import { Router } from 'express';
import * as notifications from '../controllers/notification.controller';
import { idempotent } from '../middlewares/idempotency';
import { route } from '../utils/http';

export const notificationsRouter = Router();

notificationsRouter.get('/', route(200, notifications.list));
notificationsRouter.get('/unread-count', route(200, notifications.unreadCount));
notificationsRouter.get('/preferences', route(200, notifications.getPreferences));
notificationsRouter.put('/preferences', idempotent(200, notifications.updatePreferences));
notificationsRouter.patch('/read-all', idempotent(204, notifications.markAllRead));
notificationsRouter.patch('/:notificationId/read', idempotent(200, notifications.markRead));
