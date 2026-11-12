import { Router } from 'express';
import { db } from '../database';
import { idempotent } from '../middlewares/idempotency';
import * as templates from '../services/expense-template.service';
import { currentUser, route, uuidParam } from '../utils/http';
import { parseBody } from '../validators/common';
import { CreateExpenseTemplate } from '../validators/expense-template.validator';

export const expenseTemplatesRouter = Router();

expenseTemplatesRouter.get(
    '/group/:groupId',
    route(200, (req) => templates.listTemplates(db, currentUser(req).id, uuidParam(req, 'groupId'))),
);
expenseTemplatesRouter.post(
    '/',
    idempotent(201, (req, conn) =>
        templates.createTemplate(conn, currentUser(req).id, parseBody(CreateExpenseTemplate, req.body)),
    ),
);
expenseTemplatesRouter.delete(
    '/:templateId',
    idempotent(204, (req, conn) =>
        templates.deleteTemplate(conn, currentUser(req).id, uuidParam(req, 'templateId')),
    ),
);
