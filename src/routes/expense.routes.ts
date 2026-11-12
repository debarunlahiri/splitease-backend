import { raw, Router } from 'express';
import * as expenses from '../controllers/expense.controller';
import { db, tx } from '../database';
import { idempotent } from '../middlewares/idempotency';
import { MAX_ATTACHMENT_BYTES, readAttachment, stageAttachment } from '../services/attachment.service';
import { badRequest } from '../utils/errors';
import { asyncHandler, currentUser, route, uuidParam } from '../utils/http';

export const expensesRouter = Router();

expensesRouter.post('/', idempotent(201, expenses.create));
expensesRouter.put(
    '/group/:groupId/attachments/:attachmentId',
    raw({ type: 'application/octet-stream', limit: MAX_ATTACHMENT_BYTES, inflate: false }),
    route(204, (req) => {
        const user = currentUser(req);
        const groupId = uuidParam(req, 'groupId');
        const id = uuidParam(req, 'attachmentId');
        let name: string;
        try {
            name = decodeURIComponent(req.get('X-Attachment-Name') ?? '');
        } catch {
            throw badRequest('Invalid attachment filename');
        }
        const contentType = req.get('X-Attachment-Type') ?? 'application/octet-stream';
        return tx((conn) => stageAttachment(conn, groupId, user.id, id, name, contentType, req.body));
    }),
);
expensesRouter.get('/attachments/:attachmentId', asyncHandler(async (req, res) => {
    const data = await readAttachment(db, currentUser(req).id, uuidParam(req, 'attachmentId'));
    res.set({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
    }).send(data);
}));
expensesRouter.get('/group/:groupId', route(200, expenses.byGroup));
expensesRouter.put('/:expenseId', idempotent(200, expenses.update));
expensesRouter.get('/group/:groupId/claims', route(200, expenses.pendingClaims));
expensesRouter.post('/claims/:claimId/confirm', idempotent(200, expenses.confirmClaim));
expensesRouter.post('/claims/:claimId/reject', idempotent(200, expenses.rejectClaim));
expensesRouter.post('/:expenseId/claims', idempotent(201, expenses.createClaim));
expensesRouter.post('/:expenseId/payments', idempotent(200, expenses.recordPayment));
expensesRouter.post('/:expenseId/notify', idempotent(200, expenses.nudge));
expensesRouter.delete('/:expenseId', idempotent(204, expenses.remove));
expensesRouter.get('/:expenseId/history', route(200, expenses.history));
