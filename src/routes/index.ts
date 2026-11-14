import { Router } from 'express';
import { inviteLandingPage } from '../controllers/landing.controller';
import { health } from '../controllers/health.controller';
import { brandLogoPath, brandLogoUrl } from '../utils/brand';
import { adminRouter } from './admin.routes';
import { appRouter } from './app.routes';
import { authRouter } from './auth.routes';
import { expenseTemplatesRouter } from './expense-template.routes';
import { expensesRouter } from './expense.routes';
import { friendsRouter } from './friend.routes';
import { groupsRouter } from './group.routes';
import { iosUpdateRouter } from './ios-update.routes';
import { invoicesRouter } from './invoice.routes';
import { ledgerRouter } from './ledger.routes';
import { payLinksRouter, publicPayRouter } from './pay-link.routes';
import { notificationsRouter } from './notification.routes';
import { recurringRouter } from './recurring.routes';
import { settlementsRouter } from './settlement.routes';
import { subscriptionsRouter } from './subscription.routes';
import { usersRouter } from './user.routes';

export const routes = Router();

routes.get('/health', health);
routes.get('/actuator/health', health);
routes.get('/join', inviteLandingPage);
routes.get(brandLogoUrl, (_req, res, next) => {
    res.sendFile(brandLogoPath, { maxAge: '1d' }, (error) => {
        if (error) next(error);
    });
});

routes.use('/api/v1/admin', adminRouter);
routes.use('/api/v1/app', appRouter);
routes.use('/api/v1/auth', authRouter);
routes.use('/api/v1/users', usersRouter);
routes.use('/api/v1/groups', groupsRouter);
routes.use('/api/v1/ios-updates', iosUpdateRouter);
routes.use('/api/v1/expenses', expensesRouter);
routes.use('/api/v1/expense-templates', expenseTemplatesRouter);
routes.use('/api/v1/friends', friendsRouter);
routes.use('/api/v1/ledger', ledgerRouter);
routes.use('/api/v1/invoices', invoicesRouter);
routes.use('/api/v1/pay-links', payLinksRouter);
routes.use('/api/v1/public/pay', publicPayRouter);
routes.use('/api/v1/recurring', recurringRouter);
routes.use('/api/v1/settlements', settlementsRouter);
routes.use('/api/v1/subscriptions', subscriptionsRouter);
routes.use('/api/v1/notifications', notificationsRouter);
