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
import { projectExpense } from './settlement.service';
import { AttachmentView, listAttachments, replaceAttachments } from './attachment.service';
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
    shares: { userId: string; value: number }[];
    createdAt: Date;
    updatedAt: Date | null;
    category: string | null;
    notes: string | null;
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
}

interface ShareRow {
    expense_id: string;
    user_id: string;
    amount: string;
}

const PARTICIPANTS_MUST_BE_MEMBERS = 'Every expense participant must belong to the group';

function view(
    expense: any,
    shares: { userId: string; amount: string | Decimal }[],
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
        shares: shares.map((share) => ({ userId: share.userId, value: toJsonNumber(share.amount) })),
        createdAt: expense.created_at,
        updatedAt: expense.updated_at,
        category: expense.category,
        notes: expense.notes,
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
            `SELECT expense_id, user_id, amount FROM expense_shares
             WHERE expense_id = ANY($1::uuid[]) ORDER BY user_id ASC`,
            [expenseIds],
        )
    ).rows;
}

async function insertShares(db: Db, expenseId: string, shares: Share[]): Promise<void> {
    for (const share of shares) {
        await db.query(
            'INSERT INTO expense_shares (id, expense_id, user_id, amount) VALUES ($1, $2, $3, $4)',
            [randomUUID(), expenseId, share.userId, toAmountText(share.amount)],
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
    action: 'CREATED' | 'UPDATED' | 'DELETED',
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

function asShares(rows: ShareRow[]): { userId: string; amount: string }[] {
    return rows.map((row) => ({ userId: row.user_id, amount: row.amount }));
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
                  receipt_storage_key, revision)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 0)
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
            ],
        )
    ).rows[0];
    await insertShares(db, expense.id, shares);
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
): Promise<ExpenseView> {
    const existing = await lockedExpense(db, expenseId);
    await requireEditor(db, userId, existing);
    if (userId !== input.paidBy) {
        throw forbidden('The payer must be the editing user');
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
            ],
        )
    ).rows[0];
    await db.query('DELETE FROM expense_shares WHERE expense_id = $1', [expenseId]);
    await insertShares(db, expenseId, shares);
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
    };
    await projectExpense(db, expenseId, expense.group_id, event.revision, event.current);
    await appendEvent(db, Topics.expenseChanged, 'ExpenseChangedEvent', expense.group_id, expenseId, event);
    const result = view(expense, shares, (await listAttachments(db, [expenseId])).get(expenseId));
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
    return pageResponse(
        rows.map((row) => ({
            id: row.id,
            actorId: row.actor_id,
            action: row.action,
            revision: row.revision,
            snapshot: row.snapshot,
            occurredAt: row.occurred_at,
        })),
        page,
        total,
    );
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
