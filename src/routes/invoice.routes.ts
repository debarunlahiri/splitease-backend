import { Router } from 'express';
import { db } from '../database';
import * as invoices from '../services/invoice.service';
import { currentUser, pageRequest, route } from '../utils/http';

export const invoicesRouter = Router();

/** `GET /api/v1/invoices?q=SE-2026-000012&page=0` – your invoices (issued and received), searchable. */
invoicesRouter.get(
    '/',
    route(200, (req) => {
        const q = typeof req.query.q === 'string' && req.query.q.length <= 100 ? req.query.q : undefined;
        return invoices.listInvoices(db, currentUser(req).id, pageRequest(req), q);
    }),
);
