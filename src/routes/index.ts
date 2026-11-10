import { Router } from 'express';
import { inviteLandingPage } from '../controllers/landing.controller';
import { health } from '../controllers/health.controller';
import { appRouter } from './app.routes';
import { authRouter } from './auth.routes';
import { expensesRouter } from './expense.routes';
import { friendsRouter } from './friend.routes';
import { groupsRouter } from './group.routes';
import { iosUpdateRouter } from './ios-update.routes';
import { notificationsRouter } from './notification.routes';
import { settlementsRouter } from './settlement.routes';
import { subscriptionsRouter } from './subscription.routes';
import { usersRouter } from './user.routes';

export const routes = Router();

routes.get('/health', health);
routes.get('/actuator/health', health);
routes.get('/join', inviteLandingPage);

routes.use('/api/v1/app', appRouter);
routes.use('/api/v1/auth', authRouter);
routes.use('/api/v1/users', usersRouter);
routes.use('/api/v1/groups', groupsRouter);
routes.use('/api/v1/ios-updates', iosUpdateRouter);
routes.use('/api/v1/expenses', expensesRouter);
routes.use('/api/v1/friends', friendsRouter);
routes.use('/api/v1/settlements', settlementsRouter);
routes.use('/api/v1/subscriptions', subscriptionsRouter);
routes.use('/api/v1/notifications', notificationsRouter);
