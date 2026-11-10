import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { advisoryLock, Db } from '../database';
import { badRequest } from '../utils/errors';
import { PageRequest, PageResponse, pageResponse } from '../utils/http';
import { toAmountText, toJsonNumber } from '../utils/money';
import { appendEvent, subscribe } from '../events/outbox';
import {
    ExpenseChangedEvent,
    ExpenseCreatedEvent,
    ExpenseSnapshot,
    SettlementRecordedEvent,
    Topics,
} from '../events/types';
import { requireMember, requireMembers } from './group.service';

export interface SettlementView {
    id: string;
    groupId: string;
    payerId: string;
    payeeId: string;
    amount: number;
    currency: string;
    note: string | null;
    createdAt: Date;
}

export interface BalanceView {
    userId: string;
    /** Positive: the group owes this user. Negative: this user owes the group. */
    amount: number;
    currency: string;
    updatedAt: Date;
}

export interface SuggestedPayment {
    fromUserId: string;
    toUserId: string;
    amount: number;
    currency: string;
}

function settlementView(row: any): SettlementView {
    return {
        id: row.id,
        groupId: row.group_id,
        payerId: row.payer_id,
        payeeId: row.payee_id,
        amount: toJsonNumber(row.amount),
        currency: row.currency,
        note: row.note,
        createdAt: row.created_at,
    };
}

// ------------------------------------------------------------- settlements

export async function recordSettlement(
    db: Db,
    payerId: string,
    input: { groupId: string; payeeId: string; amount: Decimal; currency: string; note: string | null },
): Promise<SettlementView> {
    if (payerId === input.payeeId) {
        throw badRequest('Payer and payee must be different users');
    }
    await requireMembers(
        db,
        input.groupId,
        [payerId, input.payeeId],
        'Every settlement participant must belong to the group',
    );
    const now = new Date();
    const settlement = (
        await db.query(
            `INSERT INTO settlements (id, group_id, payer_id, payee_id, amount, currency, note, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [
                randomUUID(),
                input.groupId,
                payerId,
                input.payeeId,
                toAmountText(input.amount),
                input.currency,
                input.note,
                now,
            ],
        )
    ).rows[0];
    const event: SettlementRecordedEvent = {
        eventId: randomUUID(),
        settlementId: settlement.id,
        groupId: settlement.group_id,
        payerId,
        payeeId: input.payeeId,
        amount: toAmountText(settlement.amount),
        currency: settlement.currency,
        occurredAt: now.toISOString(),
    };
    await appendEvent(
        db,
        Topics.settlementRecorded,
        'SettlementRecordedEvent',
        settlement.group_id,
        settlement.id,
        event,
    );
    return settlementView(settlement);
}

export async function settlementsByGroup(
    db: Db,
    userId: string,
    groupId: string,
    page: PageRequest,
): Promise<PageResponse<SettlementView>> {
    await requireMember(db, groupId, userId);
    const total = (
        await db.query('SELECT COUNT(*) AS total FROM settlements WHERE group_id = $1', [groupId])
    ).rows[0].total;
    const rows = (
        await db.query(
            `SELECT * FROM settlements WHERE group_id = $1
             ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
            [groupId, page.size, page.offset],
        )
    ).rows;
    return pageResponse(rows.map(settlementView), page, total);
}

// ---------------------------------------------------------------- balances

function normalizeCurrency(currency: unknown): string {
    if (typeof currency !== 'string' || !/^[A-Za-z]{3}$/.test(currency)) {
        throw badRequest('Currency must be a three-letter ISO code');
    }
    return currency.toUpperCase();
}

async function balanceRows(db: Db, userId: string, groupId: string, currency: string): Promise<any[]> {
    await requireMember(db, groupId, userId);
    return (
        await db.query(
            `SELECT user_id, amount, currency, updated_at FROM group_balances
             WHERE group_id = $1 AND currency = $2 ORDER BY user_id ASC`,
            [groupId, currency],
        )
    ).rows;
}

export async function balances(
    db: Db,
    userId: string,
    groupId: string,
    currency: unknown,
): Promise<BalanceView[]> {
    const rows = await balanceRows(db, userId, groupId, normalizeCurrency(currency));
    return rows.map((row) => ({
        userId: row.user_id,
        amount: toJsonNumber(row.amount),
        currency: row.currency,
        updatedAt: row.updated_at,
    }));
}

/** Greedily matches the largest debtors with the largest creditors. */
export function simplifyDebts(amounts: Map<string, Decimal>, currency: string): SuggestedPayment[] {
    const accounts = (owes: boolean) =>
        [...amounts.entries()]
            .filter(([, amount]) => (owes ? amount.isNegative() : amount.isPositive()) && !amount.isZero())
            .map(([userId, amount]) => ({ userId, amount: amount.abs() }))
            .sort((left, right) => right.amount.comparedTo(left.amount));
    const debtors = accounts(true);
    const creditors = accounts(false);
    const payments: SuggestedPayment[] = [];
    let debtorIndex = 0;
    let creditorIndex = 0;
    while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
        const debtor = debtors[debtorIndex];
        const creditor = creditors[creditorIndex];
        const amount = Decimal.min(debtor.amount, creditor.amount);
        payments.push({
            fromUserId: debtor.userId,
            toUserId: creditor.userId,
            amount: toJsonNumber(amount),
            currency,
        });
        debtor.amount = debtor.amount.minus(amount);
        creditor.amount = creditor.amount.minus(amount);
        if (debtor.amount.isZero()) debtorIndex++;
        if (creditor.amount.isZero()) creditorIndex++;
    }
    return payments;
}

export async function suggestions(
    db: Db,
    userId: string,
    groupId: string,
    currency: unknown,
): Promise<SuggestedPayment[]> {
    const normalized = normalizeCurrency(currency);
    const rows = await balanceRows(db, userId, groupId, normalized);
    return simplifyDebts(
        new Map(rows.map((row) => [row.user_id as string, new Decimal(row.amount)])),
        normalized,
    );
}

// ------------------------------------------------------ balance projection

async function adjust(
    db: Db,
    groupId: string,
    userId: string,
    currency: string,
    delta: Decimal,
): Promise<void> {
    await db.query(
        `INSERT INTO group_balances (id, group_id, user_id, currency, amount, updated_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
         ON CONFLICT (group_id, user_id, currency)
         DO UPDATE SET
             amount = group_balances.amount + EXCLUDED.amount,
             updated_at = CURRENT_TIMESTAMP`,
        [randomUUID(), groupId, userId, currency, toAmountText(delta)],
    );
}

/** Credits the payer and debits each participant; `forward` false reverses it. */
async function apply(
    db: Db,
    groupId: string,
    snapshot: ExpenseSnapshot | null,
    forward: boolean,
): Promise<void> {
    if (!snapshot) return;
    const sign = forward ? 1 : -1;
    await adjust(db, groupId, snapshot.paidBy, snapshot.currency, new Decimal(snapshot.amount).times(sign));
    for (const share of snapshot.shares) {
        await adjust(db, groupId, share.userId, snapshot.currency, new Decimal(share.amount).times(-sign));
    }
}

/**
 * Replaces the stored snapshot of an expense with `current` and applies the difference
 * to the balances. An older or repeated revision never overwrites a newer one.
 */
export async function projectExpense(
    db: Db,
    expenseId: string,
    groupId: string,
    revision: number,
    current: ExpenseSnapshot | null,
): Promise<void> {
    await advisoryLock(db, `expense-projection:${expenseId}`);
    await advisoryLock(db, `group-balances:${groupId}`);
    const projection = (
        await db.query('SELECT revision, snapshot FROM expense_projections WHERE expense_id = $1', [
            expenseId,
        ])
    ).rows[0];
    if (projection && BigInt(projection.revision) >= BigInt(revision)) return;
    const previous: ExpenseSnapshot | null =
        projection && projection.snapshot !== null ? JSON.parse(projection.snapshot) : null;
    await apply(db, groupId, previous, false);
    await apply(db, groupId, current, true);
    await db.query(
        `INSERT INTO expense_projections (expense_id, group_id, revision, snapshot)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (expense_id) DO UPDATE SET revision = EXCLUDED.revision, snapshot = EXCLUDED.snapshot`,
        [expenseId, groupId, revision, current === null ? null : JSON.stringify(current)],
    );
}

const CONSUMER = 'settlement-balance-projection';

/** Keeps group_balances up to date from expense and settlement events. */
export function registerBalanceProjection(): void {
    subscribe(Topics.expenseCreated, CONSUMER, (db, event: ExpenseCreatedEvent) =>
        projectExpense(db, event.expenseId, event.groupId, 0, {
            paidBy: event.paidBy,
            amount: event.amount,
            currency: event.currency,
            shares: event.shares,
        }),
    );
    subscribe(Topics.expenseChanged, CONSUMER, (db, event: ExpenseChangedEvent) =>
        projectExpense(db, event.expenseId, event.groupId, event.revision, event.current),
    );
    subscribe(Topics.settlementRecorded, CONSUMER, async (db, event: SettlementRecordedEvent) => {
        await advisoryLock(db, `group-balances:${event.groupId}`);
        const amount = new Decimal(event.amount);
        await adjust(db, event.groupId, event.payerId, event.currency, amount);
        await adjust(db, event.groupId, event.payeeId, event.currency, amount.negated());
    });
}
