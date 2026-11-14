import { randomBytes, randomUUID } from 'node:crypto';
import { Db } from '../database';
import { config } from '../config';
import Decimal from 'decimal.js';
import { badRequest, HttpError, notFound } from '../utils/errors';
import { requireMember, requireMembers } from './group.service';
import { claimFromLink } from './payment-claim.service';

const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;

/** 10 random characters: short enough to type, far too many combinations to guess. */
function newCode(): string {
    const bytes = randomBytes(10);
    return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
}

export interface PayLinkPayload {
    v: 1;
    d: string;
    c: string;
    n: string;
    u?: string;
    /** n = name, a = amount, d = that person's own due date, u = their user id (kept on the server) */
    t: { n: string; a: string; d?: string; u?: string }[];
    /** Group and (for a single-expense link) expense this link is about; kept on the server. */
    g?: string;
    x?: string;
    b?: string;
}

export async function createPayLink(db: Db, userId: string, payload: PayLinkPayload): Promise<{ code: string; url: string; expiresAt: Date }> {
    // A link that can take "I've paid" must belong to the caller's own group and expense, with real members.
    // Whenever that does not hold (the caller was not the one paid, someone is not in the group, ...), still give a
    // short link, but a plain one: without the group and expense it cannot record payments.
    if (payload.g) {
        let live = false;
        try {
            await requireMember(db, payload.g, userId);
            if (payload.x) {
                const expense = (await db.query('SELECT paid_by, group_id FROM expenses WHERE id = $1', [payload.x])).rows[0];
                if (!expense || expense.paid_by !== userId || expense.group_id !== payload.g) {
                    throw badRequest('That expense is not yours in this group');
                }
            }
            await requireMembers(db, payload.g, payload.t.map((p) => p.u).filter((u): u is string => Boolean(u)), 'Everyone on the link must be in the group');
            live = true;
        } catch (error) {
            if (!(error instanceof HttpError)) throw error;
        }
        if (!live) {
            const { g, x, ...plain } = payload;
            payload = { ...plain, t: payload.t.map(({ u, ...person }) => person) };
        }
    }
    const now = new Date();
    const expiresAt = new Date(now.getTime() + LIFETIME_MS);
    for (let attempt = 0; attempt < 5; attempt++) {
        const code = newCode();
        const result = await db.query(
            `INSERT INTO pay_links (code, created_by, payload, created_at, expires_at)
             VALUES ($1, $2, $3, $4, $5) ON CONFLICT (code) DO NOTHING`,
            [code, userId, JSON.stringify(payload), now, expiresAt],
        );
        if (result.rowCount === 1) return { code, url: `${config.appUrls[0]}/p/${code}`, expiresAt };
    }
    throw new Error('Could not create a pay link');
}

/** Groups made before the setting existed (or deleted ones) count as enabled. */
async function invoicesEnabled(db: Db, groupId: string): Promise<boolean> {
    const row = (await db.query('SELECT invoices_enabled FROM expense_groups WHERE id = $1', [groupId])).rows[0];
    return row ? row.invoices_enabled !== false : true;
}

export type PersonState = 'UNPAID' | 'CLAIMED' | 'PAID' | 'NOT_RECEIVED';

/**
 * Public: whoever has the code can see the split it was made for (without internal ids). For links that can take
 * "I've paid", each person also carries their live state: unpaid, said they paid, confirmed paid, or the payer said
 * the money hasn't arrived.
 */
export async function readPayLink(db: Db, code: string) {
    const row = (
        await db.query('SELECT created_by, payload FROM pay_links WHERE code = $1 AND expires_at > now()', [code])
    ).rows[0];
    if (!row) throw notFound('This link has expired or does not exist');
    const payload: PayLinkPayload = row.payload;
    const { g, x, t, ...rest } = payload;
    const ids = t.map((p) => p.u).filter((u): u is string => Boolean(u));
    const live = Boolean(g && ids.length > 0);
    const states = new Map<string, { state: PersonState; left: string; paid: string }>();
    // For a whole-group link: which expenses each person still owes for, so they can see what they are paying.
    const items = new Map<string, { d: string; a: string; t: string }[]>();
    if (live) {
        const scope = [g, row.created_by, ids, x ?? null];
        const sums = (
            await db.query(
                `SELECT s.user_id, SUM(s.amount) AS total, SUM(s.paid_amount) AS paid
                 FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
                 WHERE e.group_id = $1 AND e.paid_by = $2 AND e.deleted_at IS NULL AND s.user_id = ANY($3::uuid[])
                   AND ($4::uuid IS NULL OR e.id = $4)
                 GROUP BY s.user_id`,
                scope,
            )
        ).rows;
        const latest = new Map<string, string>(
            (
                await db.query(
                    `SELECT DISTINCT ON (c.user_id) c.user_id, c.status
                     FROM expense_payment_claims c JOIN expenses e ON e.id = c.expense_id
                     WHERE e.group_id = $1 AND e.paid_by = $2 AND c.user_id = ANY($3::uuid[]) AND ($4::uuid IS NULL OR e.id = $4)
                     ORDER BY c.user_id, c.created_at DESC`,
                    scope,
                )
            ).rows.map((r: any) => [r.user_id, r.status]),
        );
        const pending = new Set<string>(
            (
                await db.query(
                    `SELECT DISTINCT c.user_id
                     FROM expense_payment_claims c JOIN expenses e ON e.id = c.expense_id
                     WHERE c.status = 'PENDING' AND e.group_id = $1 AND e.paid_by = $2 AND c.user_id = ANY($3::uuid[])
                       AND ($4::uuid IS NULL OR e.id = $4)`,
                    scope,
                )
            ).rows.map((r: any) => r.user_id),
        );
        if (!x) {
            const owed = (
                await db.query(
                    `SELECT s.user_id, e.description, e.expense_date, s.amount, s.paid_amount
                     FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
                     WHERE e.group_id = $1 AND e.paid_by = $2 AND e.deleted_at IS NULL AND s.user_id = ANY($3::uuid[])
                       AND s.amount > s.paid_amount
                     ORDER BY e.expense_date ASC, e.created_at ASC`,
                    [g, row.created_by, ids],
                )
            ).rows;
            for (const r of owed) {
                const list = items.get(r.user_id) ?? [];
                if (list.length >= 50) continue;
                list.push({
                    d: String(r.description).slice(0, 160),
                    a: new Decimal(r.amount).minus(r.paid_amount).toFixed(2),
                    t: String(r.expense_date instanceof Date ? r.expense_date.toISOString() : r.expense_date).slice(0, 10),
                });
                items.set(r.user_id, list);
            }
        }
        for (const sum of sums) {
            const left = new Decimal(sum.total).minus(sum.paid);
            const state: PersonState = left.lte(0)
                ? 'PAID'
                : pending.has(sum.user_id)
                  ? 'CLAIMED'
                  : latest.get(sum.user_id) === 'REJECTED'
                    ? 'NOT_RECEIVED'
                    : 'UNPAID';
            states.set(sum.user_id, { state, left: Decimal.max(left, 0).toFixed(2), paid: new Decimal(sum.paid).toFixed(2) });
        }
    }
    return {
        ...rest,
        claims: live,
        invoices: g ? await invoicesEnabled(db, g) : true,
        t: t.map(({ u, ...person }) => {
            const info = u ? states.get(u) : undefined;
            const owed = u ? items.get(u) : undefined;
            return info
                ? { ...person, s: info.state, l: info.left, p: info.paid, ...(owed?.length ? { i: owed } : {}) }
                : person;
        }),
    };
}

/** Public: a visitor tapped "I've paid" for the person at [index] on the link. */
export async function claimFromPayLink(db: Db, code: string, index: number, amount: Decimal | null) {
    const row = (
        await db.query('SELECT created_by, payload FROM pay_links WHERE code = $1 AND expires_at > now()', [code])
    ).rows[0];
    if (!row) throw notFound('This link has expired or does not exist');
    const payload: PayLinkPayload = row.payload;
    const person = payload.t[index];
    if (!payload.g || !person?.u) throw badRequest('This link cannot record payments');
    return claimFromLink(
        db,
        { createdBy: row.created_by, groupId: payload.g, expenseId: payload.x, userId: person.u },
        amount,
    );
}

export interface InvoiceView {
    number: string;
    issuedAt: string;
    status: 'PAID' | 'PARTIAL';
    payee: { name: string; upiId: string | null };
    payer: { name: string };
    groupName: string;
    currency: string;
    items: { description: string; date: string; amount: string; paid: string }[];
    totalAmount: string;
    totalPaid: string;
    balance: string;
}

/**
 * Public: an invoice / receipt for one person on a pay link, listing what they were charged for and what the payer
 * has confirmed as received. Only available once something has been paid.
 */
export async function invoiceFromPayLink(db: Db, code: string, index: number): Promise<InvoiceView> {
    const link = (
        await db.query('SELECT created_by, payload FROM pay_links WHERE code = $1 AND expires_at > now()', [code])
    ).rows[0];
    if (!link) throw notFound('This link has expired or does not exist');
    const payload: PayLinkPayload = link.payload;
    const person = payload.t[index];
    if (!payload.g || !person?.u) throw badRequest('This link has no invoices');
    if (!(await invoicesEnabled(db, payload.g))) throw notFound('Invoices are turned off for this group');
    const rows = (
        await db.query(
            `SELECT e.description, e.expense_date, e.currency, s.amount, s.paid_amount
             FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
             WHERE e.group_id = $1 AND e.paid_by = $2 AND e.deleted_at IS NULL AND s.user_id = $3
               AND ($4::uuid IS NULL OR e.id = $4)
             ORDER BY e.expense_date ASC, e.created_at ASC`,
            [payload.g, link.created_by, person.u, payload.x ?? null],
        )
    ).rows;
    const totalPaid = rows.reduce((sum: Decimal, r: any) => sum.plus(r.paid_amount), new Decimal(0));
    if (rows.length === 0 || totalPaid.lte(0)) throw notFound('There is nothing paid to invoice yet');
    const totalAmount = rows.reduce((sum: Decimal, r: any) => sum.plus(r.amount), new Decimal(0));
    const paidAt = (
        await db.query(
            `SELECT max(created_at) AS at FROM settlements WHERE payer_id = $1 AND payee_id = $2 AND group_id = $3`,
            [person.u, link.created_by, payload.g],
        )
    ).rows[0]?.at ?? new Date();
    const names = new Map<string, string>(
        (
            await db.query('SELECT id, display_name, upi_id FROM users WHERE id = ANY($1::uuid[])', [[person.u, link.created_by]])
        ).rows.map((r: any) => [r.id, `${r.display_name}\u0000${r.upi_id ?? ''}`]),
    );
    const [payeeName, payeeUpi] = (names.get(link.created_by) ?? 'Someone\u0000').split('\u0000');
    const [payerName] = (names.get(person.u) ?? 'Someone\u0000').split('\u0000');
    const group = (await db.query('SELECT name FROM expense_groups WHERE id = $1', [payload.g])).rows[0];
    const issued = new Date(paidAt);
    const status = totalPaid.gte(totalAmount) ? 'PAID' : 'PARTIAL';
    const items = rows.map((r: any) => ({
        description: r.description,
        date: String(r.expense_date instanceof Date ? r.expense_date.toISOString() : r.expense_date).slice(0, 10),
        amount: new Decimal(r.amount).toFixed(2),
        paid: new Decimal(r.paid_amount).toFixed(2),
    }));
    // The invoice is a stored record: it gets its number the first time and keeps it, so it can be found later.
    // Look it up first so re-opening an invoice never uses up a number from the sequence.
    const key = [link.created_by, person.u, payload.g, payload.x ?? payload.g];
    const refresh = async () =>
        (
            await db.query(
                `UPDATE invoices
                 SET total = $5, paid = $6, status = $7, items = $8, paid_at = $9, link_code = $10, link_index = $11, updated_at = now()
                 WHERE payee_id = $1 AND payer_id = $2 AND group_id = $3 AND expense_key = $4
                 RETURNING number`,
                [...key, totalAmount.toFixed(2), totalPaid.toFixed(2), status, JSON.stringify(items), issued, code, index],
            )
        ).rows[0];
    let stored = await refresh();
    if (!stored) {
        stored = (
            await db.query(
                `INSERT INTO invoices (id, number, payee_id, payer_id, group_id, expense_key, link_code, link_index,
                                       currency, total, paid, status, items, created_at, paid_at, updated_at)
                 VALUES ($1, 'SE-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('invoice_seq')::text, 6, '0'),
                         $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), $13, now())
                 ON CONFLICT (payee_id, payer_id, group_id, expense_key) DO NOTHING
                 RETURNING number`,
                [
                    randomUUID(), ...key, code, index,
                    rows[0].currency, totalAmount.toFixed(2), totalPaid.toFixed(2), status, JSON.stringify(items), issued,
                ],
            )
        ).rows[0];
        // Someone else made it in the meantime: use theirs.
        if (!stored) stored = await refresh();
    }
    return {
        number: stored.number,
        issuedAt: issued.toISOString(),
        status,
        payee: { name: payeeName, upiId: payeeUpi || null },
        payer: { name: payerName },
        groupName: group?.name ?? '',
        currency: rows[0].currency,
        items,
        totalAmount: totalAmount.toFixed(2),
        totalPaid: totalPaid.toFixed(2),
        balance: Decimal.max(totalAmount.minus(totalPaid), 0).toFixed(2),
    };
}
