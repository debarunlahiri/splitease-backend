import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { Db } from '../database';
import { badRequest, forbidden, notFound } from '../utils/errors';
import { PageRequest, PageResponse, pageResponse } from '../utils/http';
import { toAmountText, toJsonNumber } from '../utils/money';
import { appendEvent } from '../events/outbox';
import {
    ExpenseChangedEvent,
    ExpenseCreatedEvent,
    ExpenseSnapshot,
    Topics,
} from '../events/types';
import { requireMember, requireMembers } from './group.service';
import { projectExpense, recordSettlement } from './settlement.service';
import { AttachmentView, listAttachments, replaceAttachments } from './attachment.service';
import { describeChanges, HistoryChange, parseSnapshot, snapshotUserIds, summarize } from './expense-history';
import { calculateSplit, RequestedShare, Share, SplitType } from '../utils/split-calculator';

export interface Receipt {
    name: string;
    contentType: string;
    storageKey: string;
}

export interface ExpenseInput {
    paidBy: string;
    description: string;
    amount: Decimal;
    currency: string;
    expenseDate: string;
    splitType: SplitType;
    shares: RequestedShare[];
    category: string | null;
    notes: string | null;
    remindAfterDays?: number | null;
    payByDate?: string | null;
    receipt?: Receipt | null;
    attachmentIds?: string[];
}

export interface ExpenseView {
    id: string;
    groupId: string;
    paidBy: string;
    description: string;
    amount: number;
    currency: string;
    expenseDate: string;
    splitType: SplitType;
    /** `amount` is each person's final share in the expense currency; `value` mirrors it for older clients. */
    shares: {
        userId: string;
        value: number;
        amount: number;
        /** How much of `amount` has been paid back to the payer (the payer's own share counts as paid). */
        paidAmount: number;
        dueDate: string | null;
        payByDate: string | null;
        status: 'UNPAID' | 'PARTIAL' | 'PAID';
    }[];
    createdAt: Date;
    updatedAt: Date | null;
    category: string | null;
    notes: string | null;
    /** Nudge the payer this many days after creation if still unsettled (free for everyone for now). */
    remindAfterDays: number | null;
    payByDate: string | null;
    receipt: Receipt | null;
    attachments: AttachmentView[];
    revision: number;
}

export interface AuditView {
    id: string;
    actorId: string;
    action: string;
    revision: number;
    /** The expense as JSON text at that revision. */
    snapshot: string;
    occurredAt: Date;
    /** Who made the change, one line saying what happened, and exactly what changed. */
    actorName: string | null;
    summary: string;
    changes: HistoryChange[];
}

interface ShareRow {
    expense_id: string;
    user_id: string;
    amount: string;
    paid_amount?: string;
    pay_by_date?: string | Date | null;
}

const PARTICIPANTS_MUST_BE_MEMBERS = 'Every expense participant must belong to the group';

function dayText(value: unknown): string | null {
    if (!value) return null;
    return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function view(
    expense: any,
    shares: { userId: string; amount: string | Decimal; paidAmount?: string | Decimal; payByDate?: string | null }[],
    attachments: AttachmentView[] = [],
): ExpenseView {
    return {
        id: expense.id,
        groupId: expense.group_id,
        paidBy: expense.paid_by,
        description: expense.description,
        amount: toJsonNumber(expense.amount),
        currency: expense.currency,
        expenseDate: expense.expense_date,
        splitType: expense.split_type,
        shares: shares.map((share) => {
            const amount = new Decimal(share.amount);
            const paid = share.userId === expense.paid_by ? amount : new Decimal(share.paidAmount ?? 0);
            return {
                userId: share.userId,
                value: toJsonNumber(share.amount),
                amount: toJsonNumber(share.amount),
                paidAmount: toJsonNumber(paid),
                /** The date this person should pay by: their own, else the expense's. */
                dueDate: dayText(share.payByDate) ?? dayText(expense.pay_by_date),
                payByDate: dayText(share.payByDate),
                status: paid.gte(amount) ? ('PAID' as const) : paid.gt(0) ? ('PARTIAL' as const) : ('UNPAID' as const),
            };
        }),
        createdAt: expense.created_at,
        updatedAt: expense.updated_at,
        category: expense.category,
        notes: expense.notes,
        remindAfterDays: expense.remind_after_days ?? null,
        payByDate: expense.pay_by_date ?? null,
        attachments,
        receipt:
            expense.receipt_storage_key === null
                ? null
                : {
                      name: expense.receipt_name,
                      contentType: expense.receipt_content_type,
                      storageKey: expense.receipt_storage_key,
                  },
        revision: expense.revision,
    };
}

async function storedShares(db: Db, expenseIds: string[]): Promise<ShareRow[]> {
    if (expenseIds.length === 0) return [];
    return (
        await db.query(
            `SELECT expense_id, user_id, amount, paid_amount, pay_by_date FROM expense_shares
             WHERE expense_id = ANY($1::uuid[]) ORDER BY user_id ASC`,
            [expenseIds],
        )
    ).rows;
}

/** Inserts the shares; `paid` carries over what was already paid back when an expense is edited. */
/** Each person's own due date from the request, when they have one. */
function dueDates(requested: RequestedShare[]): Map<string, string | null> {
    return new Map(requested.map((share) => [share.userId, share.payByDate ?? null]));
}

async function insertShares(
    db: Db,
    expenseId: string,
    shares: Share[],
    paid: Map<string, Decimal> = new Map(),
    dues: Map<string, string | null> = new Map(),
): Promise<void> {
    for (const share of shares) {
        const already = Decimal.min(paid.get(share.userId) ?? new Decimal(0), share.amount);
        await db.query(
            'INSERT INTO expense_shares (id, expense_id, user_id, amount, paid_amount, pay_by_date) VALUES ($1, $2, $3, $4, $5, $6)',
            [randomUUID(), expenseId, share.userId, toAmountText(share.amount), toAmountText(already), dues.get(share.userId) ?? null],
        );
    }
}

function snapshot(
    expense: any,
    shares: { userId: string; amount: string | Decimal }[],
): ExpenseSnapshot {
    return {
        paidBy: expense.paid_by,
        amount: toAmountText(expense.amount),
        currency: expense.currency,
        shares: shares.map((share) => ({ userId: share.userId, amount: toAmountText(share.amount) })),
    };
}

async function audit(
    db: Db,
    expenseView: ExpenseView,
    actorId: string,
    action: 'CREATED' | 'UPDATED' | 'DELETED' | 'PAYMENT_RECORDED',
): Promise<void> {
    await db.query(
        `INSERT INTO expense_audit
             (id, expense_id, group_id, actor_id, action, revision, snapshot, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
            randomUUID(),
            expenseView.id,
            expenseView.groupId,
            actorId,
            action,
            expenseView.revision,
            JSON.stringify(expenseView),
            new Date(),
        ],
    );
}

/** Loads a live expense for update; deleted expenses are reported as missing. */
async function lockedExpense(db: Db, expenseId: string): Promise<any> {
    const expense = (await db.query('SELECT * FROM expenses WHERE id = $1 FOR UPDATE', [expenseId]))
        .rows[0];
    if (!expense || expense.deleted_at !== null) throw notFound('Expense not found');
    return expense;
}

async function requireEditor(db: Db, userId: string, expense: any): Promise<void> {
    await requireMember(db, expense.group_id, userId);
    if (expense.paid_by !== userId) {
        throw forbidden('Only the payer can change this expense');
    }
}

function asShares(rows: ShareRow[]): { userId: string; amount: string; paidAmount?: string; payByDate?: string | null }[] {
    return rows.map((row) => ({
        userId: row.user_id,
        amount: row.amount,
        paidAmount: row.paid_amount,
        payByDate: dayText(row.pay_by_date),
    }));
}

export async function createExpense(
    db: Db,
    userId: string,
    input: ExpenseInput & { groupId: string },
): Promise<ExpenseView> {
    if (userId !== input.paidBy) {
        throw badRequest('The payer must be the authenticated user');
    }
    await requireMember(db, input.groupId, userId);
    const shares = calculateSplit(input.amount, input.splitType, input.shares);
    await requireMembers(
        db,
        input.groupId,
        shares.map((share) => share.userId),
        PARTICIPANTS_MUST_BE_MEMBERS,
    );
    const now = new Date();
    const expense = (
        await db.query(
            `INSERT INTO expenses
                 (id, group_id, paid_by, description, amount, currency, expense_date, split_type,
                  created_at, category, notes, receipt_name, receipt_content_type,
                  receipt_storage_key, remind_after_days, pay_by_date, revision)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 0)
             RETURNING *`,
            [
                randomUUID(),
                input.groupId,
                input.paidBy,
                input.description.trim(),
                toAmountText(input.amount),
                input.currency,
                input.expenseDate,
                input.splitType,
                now,
                input.category,
                input.notes,
                input.receipt?.name ?? null,
                input.receipt?.contentType ?? null,
                input.receipt?.storageKey ?? null,
                input.remindAfterDays ?? null,
                input.payByDate ?? null,
            ],
        )
    ).rows[0];
    await insertShares(db, expense.id, shares, new Map(), dueDates(input.shares));
    if (input.attachmentIds) {
        await replaceAttachments(db, expense.id, input.groupId, userId, input.attachmentIds);
    }

    const created = snapshot(expense, shares);
    await projectExpense(db, expense.id, expense.group_id, expense.revision, created);
    const event: ExpenseCreatedEvent = {
        eventId: randomUUID(),
        actorId: userId,
        expenseId: expense.id,
        groupId: expense.group_id,
        paidBy: created.paidBy,
        amount: created.amount,
        currency: created.currency,
        shares: created.shares,
        occurredAt: now.toISOString(),
    };
    await appendEvent(db, Topics.expenseCreated, 'ExpenseCreatedEvent', expense.group_id, expense.id, event);
    const result = view(expense, shares, (await listAttachments(db, [expense.id])).get(expense.id));
    await audit(db, result, userId, 'CREATED');
    return result;
}

export async function updateExpense(
    db: Db,
    userId: string,
    expenseId: string,
    input: ExpenseInput,
    /** `skipEditorCheck`: the group's creator is adjusting someone else's split. `quiet`: send no generic update message. */
    options: { skipEditorCheck?: boolean; quiet?: boolean } = {},
): Promise<ExpenseView> {
    const existing = await lockedExpense(db, expenseId);
    if (!options.skipEditorCheck) {
        await requireEditor(db, userId, existing);
        if (userId !== input.paidBy) {
            throw forbidden('The payer must be the editing user');
        }
    } else if (input.paidBy !== existing.paid_by) {
        throw forbidden('The payer cannot change here');
    }
    const shares = calculateSplit(input.amount, input.splitType, input.shares);
    await requireMembers(
        db,
        existing.group_id,
        shares.map((share) => share.userId),
        PARTICIPANTS_MUST_BE_MEMBERS,
    );
    const previous = snapshot(existing, asShares(await storedShares(db, [expenseId])));
    const now = new Date();
    const expense = (
        await db.query(
            `UPDATE expenses
             SET paid_by = $1, description = $2, amount = $3, currency = $4, expense_date = $5,
                 split_type = $6, category = $7, notes = $8, receipt_name = $9,
                 receipt_content_type = $10, receipt_storage_key = $11, updated_at = $12,
                 remind_after_days = $14, pay_by_date = $15,
                 -- a changed reminder schedule starts over
                 reminder_sent_at = CASE WHEN remind_after_days IS DISTINCT FROM $14 THEN NULL ELSE reminder_sent_at END,
                 revision = revision + 1
             WHERE id = $13 RETURNING *`,
            [
                input.paidBy,
                input.description.trim(),
                toAmountText(input.amount),
                input.currency,
                input.expenseDate,
                input.splitType,
                input.category,
                input.notes,
                input.receipt?.name ?? null,
                input.receipt?.contentType ?? null,
                input.receipt?.storageKey ?? null,
                now,
                expenseId,
                input.remindAfterDays ?? null,
                input.payByDate ?? null,
            ],
        )
    ).rows[0];
    const paidBefore = new Map(
        (await storedShares(db, [expenseId])).map((row) => [row.user_id, new Decimal(row.paid_amount ?? 0)]),
    );
    await db.query('DELETE FROM expense_shares WHERE expense_id = $1', [expenseId]);
    await insertShares(db, expenseId, shares, paidBefore, dueDates(input.shares));
    if (input.attachmentIds) {
        await replaceAttachments(db, expenseId, existing.group_id, userId, input.attachmentIds);
    }

    const event: ExpenseChangedEvent = {
        eventId: randomUUID(),
        expenseId,
        groupId: expense.group_id,
        revision: expense.revision,
        previous,
        current: snapshot(expense, shares),
        occurredAt: now.toISOString(),
        actorId: userId,
        quiet: options.quiet,
    };
    await projectExpense(db, expenseId, expense.group_id, event.revision, event.current);
    await appendEvent(db, Topics.expenseChanged, 'ExpenseChangedEvent', expense.group_id, expenseId, event);
    const result = view(
        expense,
        shares.map((share) => ({
            ...share,
            paidAmount: Decimal.min(paidBefore.get(share.userId) ?? 0, share.amount),
            payByDate: dueDates(input.shares).get(share.userId) ?? null,
        })),
        (await listAttachments(db, [expenseId])).get(expenseId),
    );
    await audit(db, result, userId, 'UPDATED');
    return result;
}

/** Soft delete: the row stays for history and its balance changes are reversed. */
export async function deleteExpense(
    db: Db,
    userId: string,
    expenseId: string,
    options: { skipEditorCheck?: boolean } = {},
): Promise<void> {
    const existing = await lockedExpense(db, expenseId);
    if (!options.skipEditorCheck) await requireEditor(db, userId, existing);
    const shares = asShares(await storedShares(db, [expenseId]));
    const now = new Date();
    const expense = (
        await db.query(
            `UPDATE expenses SET deleted_at = $1, updated_at = $1, revision = revision + 1
             WHERE id = $2 RETURNING *`,
            [now, expenseId],
        )
    ).rows[0];
    const event: ExpenseChangedEvent = {
        eventId: randomUUID(),
        expenseId,
        groupId: expense.group_id,
        revision: expense.revision,
        previous: snapshot(existing, shares),
        current: null,
        occurredAt: now.toISOString(),
        actorId: userId,
    };
    await projectExpense(db, expenseId, expense.group_id, event.revision, event.current);
    await appendEvent(db, Topics.expenseChanged, 'ExpenseChangedEvent', expense.group_id, expenseId, event);
    await replaceAttachments(db, expenseId, expense.group_id, userId, []);
    await audit(db, view(expense, shares), userId, 'DELETED');
}

export async function expenseHistory(
    db: Db,
    userId: string,
    expenseId: string,
    page: PageRequest,
): Promise<PageResponse<AuditView>> {
    const expense = (await db.query('SELECT group_id FROM expenses WHERE id = $1', [expenseId]))
        .rows[0];
    if (!expense) throw notFound('Expense not found');
    await requireMember(db, expense.group_id, userId);
    const total = (
        await db.query('SELECT COUNT(*) AS total FROM expense_audit WHERE expense_id = $1', [
            expenseId,
        ])
    ).rows[0].total;
    const rows = (
        await db.query(
            `SELECT * FROM expense_audit WHERE expense_id = $1
             ORDER BY revision ASC LIMIT $2 OFFSET $3`,
            [expenseId, page.size, page.offset],
        )
    ).rows;
    // The revision just before this page is needed to say what its first entry changed.
    const before =
        page.offset > 0
            ? (
                  await db.query(
                      `SELECT snapshot FROM expense_audit WHERE expense_id = $1
                       ORDER BY revision ASC LIMIT 1 OFFSET $2`,
                      [expenseId, page.offset - 1],
                  )
              ).rows[0]
            : undefined;
    const ids = new Set<string>();
    for (const row of [...(before ? [before] : []), ...rows]) {
        snapshotUserIds(row.snapshot).forEach((id) => ids.add(id));
    }
    rows.forEach((row) => ids.add(row.actor_id));
    const names = new Map<string, string>(
        (
            await db.query('SELECT id, display_name FROM users WHERE id = ANY($1::uuid[])', [[...ids]])
        ).rows.map((row) => [row.id, row.display_name]),
    );
    const name = (id: string) => names.get(id) ?? 'Someone';
    let previous: string | null = before ? before.snapshot : null;
    const views = rows.map((row) => {
        const changes = row.action === 'CREATED' ? [] : describeChanges(previous, row.snapshot, name);
        previous = row.snapshot;
        return {
            id: row.id,
            actorId: row.actor_id,
            action: row.action,
            revision: row.revision,
            snapshot: row.snapshot,
            occurredAt: row.occurred_at,
            actorName: names.get(row.actor_id) ?? null,
            summary: summarize(row.action, changes, parseSnapshot(row.snapshot), name, name(row.actor_id)),
            changes,
        };
    });
    return pageResponse(views, page, total);
}

export async function expensesByGroup(
    db: Db,
    userId: string,
    groupId: string,
    page: PageRequest,
): Promise<PageResponse<ExpenseView>> {
    await requireMember(db, groupId, userId);
    const total = (
        await db.query(
            'SELECT COUNT(*) AS total FROM expenses WHERE group_id = $1 AND deleted_at IS NULL',
            [groupId],
        )
    ).rows[0].total;
    const expenses = (
        await db.query(
            `SELECT * FROM expenses WHERE group_id = $1 AND deleted_at IS NULL
             ORDER BY expense_date DESC, created_at DESC, id DESC LIMIT $2 OFFSET $3`,
            [groupId, page.size, page.offset],
        )
    ).rows;
    const ids = expenses.map((expense) => expense.id);
    const shares = await storedShares(db, ids);
    const attachments = await listAttachments(db, ids);
    return pageResponse(
        expenses.map((expense) =>
            view(
                expense,
                asShares(shares.filter((share) => share.expense_id === expense.id)),
                attachments.get(expense.id),
            ),
        ),
        page,
        total,
    );
}

/**
 * The payer marks that someone paid them back for this expense, in full (no `amount`) or in part.
 * It also records a settlement from that person to the payer so group balances stay correct.
 */
export async function recordSharePayment(
    db: Db,
    userId: string,
    expenseId: string,
    input: { userId: string; amount?: Decimal | null },
): Promise<ExpenseView> {
    const expense = await lockedExpense(db, expenseId);
    await requireEditor(db, userId, expense);
    if (input.userId === expense.paid_by) {
        throw badRequest("The payer's own share is already covered");
    }
    const share = (
        await db.query(
            'SELECT * FROM expense_shares WHERE expense_id = $1 AND user_id = $2 FOR UPDATE',
            [expenseId, input.userId],
        )
    ).rows[0];
    if (!share) throw notFound('That person is not part of this expense');
    const remaining = new Decimal(share.amount).minus(share.paid_amount);
    if (remaining.lte(0)) throw badRequest('This share is already settled');
    const amount = input.amount ?? remaining;
    if (amount.lte(0) || amount.decimalPlaces() > 2) {
        throw badRequest('Enter an amount greater than 0 with at most 2 decimal places');
    }
    if (amount.gt(remaining)) {
        throw badRequest(`Only ${toAmountText(remaining)} is still unpaid on this share`);
    }
    await db.query('UPDATE expense_shares SET paid_amount = paid_amount + $1 WHERE id = $2', [
        toAmountText(amount),
        share.id,
    ]);
    await recordSettlement(db, input.userId, {
        groupId: expense.group_id,
        payeeId: expense.paid_by,
        amount,
        currency: expense.currency,
        note: `Paid for ${expense.description}`.slice(0, 160),
    });
    // Each audit entry needs its own revision number.
    const bumped = (
        await db.query(
            'UPDATE expenses SET revision = revision + 1, updated_at = $1 WHERE id = $2 RETURNING *',
            [new Date(), expenseId],
        )
    ).rows[0];
    const rows = await storedShares(db, [expenseId]);
    const result = view(bumped, asShares(rows), (await listAttachments(db, [expenseId])).get(expenseId));
    await audit(db, result, userId, 'PAYMENT_RECORDED');
    return result;
}
