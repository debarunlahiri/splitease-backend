import { Router } from 'express';
import { z } from 'zod';
import { db, tx } from '../database';
import { idempotent } from '../middlewares/idempotency';
import * as payLinks from '../services/pay-link.service';
import { notFound } from '../utils/errors';
import { checkUpiId } from '../utils/upi';
import { currentUser, route } from '../utils/http';
import { decimal, parseBody } from '../validators/common';

const Person = z.object({ n: z.string().trim().min(1).max(100), a: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/), d: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), u: z.string().uuid().optional() });
const Payload = z.object({
    v: z.literal(1),
    d: z.string().trim().max(160),
    c: z.string().regex(/^[A-Z]{3}$/),
    n: z.string().trim().min(1).max(100),
    u: z
        .string()
        .trim()
        .toLowerCase()
        .refine((value) => checkUpiId(value).valid, 'must be a valid UPI ID')
        .optional(),
    t: z.array(Person).min(1).max(50),
    b: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    g: z.string().uuid().optional(),
    x: z.string().uuid().optional(),
});

/** Signed-in: create a short link for a split. */
export const payLinksRouter = Router();
payLinksRouter.post(
    '/',
    idempotent(201, (req, conn) =>
        payLinks.createPayLink(conn, currentUser(req).id, parseBody(Payload, req.body)),
    ),
);

/** Public: read a link by its code (no sign-in, so friends without the app can open it). */
export const publicPayRouter = Router();
publicPayRouter.get(
    '/:code',
    route(200, async (req) => {
        const code = String(req.params.code);
        if (!/^[A-Za-z0-9]{8,16}$/.test(code)) throw notFound('Link not found');
        return payLinks.readPayLink(db, code);
    }),
);

const LinkClaim = z.object({
    index: z.number().int().min(0).max(49),
    amount: decimal
        .refine((value) => value.gt(0), 'must be greater than 0')
        .refine((value) => value.decimalPlaces() <= 2, 'must have at most 2 decimal places')
        .refine((value) => value.lt('1e12'), 'is too large')
        .nullish(),
});
publicPayRouter.post(
    '/:code/claims',
    route(200, async (req) => {
        const code = String(req.params.code);
        if (!/^[A-Za-z0-9]{8,16}$/.test(code)) throw notFound('Link not found');
        const input = parseBody(LinkClaim, req.body);
        return tx((conn) => payLinks.claimFromPayLink(conn, code, input.index, input.amount ?? null));
    }),
);

publicPayRouter.get(
    '/:code/invoice/:index',
    route(200, async (req) => {
        const code = String(req.params.code);
        const index = Number(req.params.index);
        if (!/^[A-Za-z0-9]{8,16}$/.test(code) || !Number.isInteger(index) || index < 0 || index > 49) {
            throw notFound('Invoice not found');
        }
        return payLinks.invoiceFromPayLink(db, code, index);
    }),
);
