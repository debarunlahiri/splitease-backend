import { Router } from 'express';
import { z } from 'zod';
import { db } from '../database';
import { idempotent } from '../middlewares/idempotency';
import * as recurring from '../services/recurring.service';
import { currentUser, route, uuidParam } from '../utils/http';
import { isoDate, parseBody, uuid } from '../validators/common';

export const recurringRouter = Router();

const Create = z.object({
    groupId: uuid,
    frequency: z.enum(['WEEKLY', 'MONTHLY', 'YEARLY']),
    startOn: isoDate,
    endsOn: isoDate.nullish(),
    expense: z.record(z.unknown()),
});

recurringRouter.post('/', idempotent(201, (req, conn) => {
    const body = parseBody(Create, req.body);
    return recurring.createRecurring(conn, currentUser(req).id, { ...body, endsOn: body.endsOn ?? null });
}));
recurringRouter.get('/group/:groupId', route(200, (req) => recurring.listRecurring(db, currentUser(req).id, uuidParam(req, 'groupId'))));
recurringRouter.patch('/:id', idempotent(200, (req, conn) =>
    recurring.setRecurringActive(conn, currentUser(req).id, uuidParam(req, 'id'), parseBody(z.object({ active: z.boolean() }), req.body).active),
));
recurringRouter.delete('/:id', idempotent(204, (req, conn) =>
    recurring.deleteRecurring(conn, currentUser(req).id, uuidParam(req, 'id')),
));
