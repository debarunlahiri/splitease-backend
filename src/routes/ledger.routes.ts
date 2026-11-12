import { Router } from 'express';
import { z } from 'zod';
import { db } from '../database';
import { idempotent } from '../middlewares/idempotency';
import * as ledger from '../services/ledger.service';
import { asyncHandler, currentUser, route } from '../utils/http';
import { parseBody, uuid } from '../validators/common';

const Remind = z.object({
    userId: uuid,
    channels: z.array(z.enum(['PUSH', 'EMAIL'])).min(1, 'choose at least one').max(2).default(['PUSH']),
});

export const ledgerRouter = Router();

type Scope = 'all' | 'owed' | 'owe';
const scopeOf = (value: unknown): Scope => (value === 'owed' || value === 'owe' ? value : 'all');
/** A name that is different every time (and says what is inside), so exports never overwrite each other. */
const fileName = (scope: Scope, extension: string) => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const label = scope === 'owed' ? 'owed-to-you' : scope === 'owe' ? 'you-owe' : 'all';
    return `splitease-ledger-${label}-${stamp}.${extension}`;
};

ledgerRouter.get('/', route(200, (req) => ledger.ledger(db, currentUser(req).id)));
ledgerRouter.get(
    '/export.csv',
    asyncHandler(async (req, res) => {
        const scope = scopeOf(req.query.scope);
        const csv = await ledger.exportLedgerCsv(db, currentUser(req).id, scope);
        res.set({
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${fileName(scope, 'csv')}"`,
            'X-Content-Type-Options': 'nosniff',
        });
        res.status(200).send('﻿' + csv);
    }),
);
ledgerRouter.get(
    '/export.xlsx',
    asyncHandler(async (req, res) => {
        const scope = scopeOf(req.query.scope);
        const book = await ledger.exportLedgerXlsx(db, currentUser(req).id, scope);
        res.set({
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="${fileName(scope, 'xlsx')}"`,
            'X-Content-Type-Options': 'nosniff',
        });
        res.status(200).send(book);
    }),
);
ledgerRouter.post(
    '/remind',
    idempotent(200, (req, conn) => {
        const input = parseBody(Remind, req.body);
        return ledger.remindPerson(conn, currentUser(req).id, input.userId, input.channels);
    }),
);
