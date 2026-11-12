import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { Db } from '../database';
import { badRequest, forbidden, notFound } from '../utils/errors';
import { toAmountText, toJsonNumber } from '../utils/money';
import { recordSharePayment } from './expense.service';
import { requireMember } from './group.service';
import { notifyExpenseReminder } from './notification.service';

export interface ClaimView {
    id: string;
    expenseId: string;
    groupId: string;
    /** Who says they paid. */
    userId: string;
    userName: string;
    /** Who should receive the money (the expense's payer). */
    paidBy: string;
    amount: number;
    currency: string;
    description: string;
    status: 'PENDING' | 'CONFIRMED' | 'REJECTED';
    createdAt: Date;
}

const CLAIM_SQL = `
    SELECT c.*, e.paid_by, e.currency, e.description, u.display_name
    FROM expense_payment_claims c
    JOIN expenses e ON e.id = c.expense_id
    JOIN users u ON u.id = c.user_id`;

function view(row: any): ClaimView {
    return {
        id: row.id,
        expenseId: row.expense_id,
        groupId: row.group_id,
        userId: row.user_id,
        userName: row.display_name,
        paidBy: row.paid_by,
        amount: toJsonNumber(row.amount),
        currency: row.currency,
        description: row.description,
        status: row.status,
        createdAt: row.created_at,
    };
}

/**
 * Records that [userId] says they paid [amount] of their share of [expense] (a locked or fresh expense row) and
 * returns the claim. One open claim per person per expense: a new one replaces it. Does not tell the payer.
 */
async function insertClaim(db: Db, expense: any, userId: string, amount: Decimal): Promise<ClaimView> {
    await db.query(
        `DELETE FROM expense_payment_claims WHERE expense_id = $1 AND user_id = $2 AND status = 'PENDING'`,
        [expense.id, userId],
    );
    const id = randomUUID();
    await db.query(
        `INSERT INTO expense_payment_claims (id, expense_id, group_id, user_id, amount, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, expense.id, expense.group_id, userId, toAmountText(amount), new Date()],
    );
    return view((await db.query(`${CLAIM_SQL} WHERE c.id = $1`, [id])).rows[0]);
}

/** A signed-up person says they paid their share (all of what is left, or `amount`). The payer is told. */
export async function createClaim(
    db: Db,
    userId: string,
    expenseId: string,
    input: { amount?: Decimal | null },
): Promise<ClaimView> {
    const expense = (await db.query('SELECT * FROM expenses WHERE id = $1', [expenseId])).rows[0];
    if (!expense || expense.deleted_at !== null) throw notFound('Expense not found');
    await requireMember(db, expense.group_id, userId);
    if (expense.paid_by === userId) throw badRequest('You paid for this expense');
    const share = (
        await db.query('SELECT * FROM expense_shares WHERE expense_id = $1 AND user_id = $2', [expenseId, userId])
    ).rows[0];
    if (!share) throw badRequest('You are not part of this expense');
    const remaining = new Decimal(share.amount).minus(share.paid_amount);
    if (remaining.lte(0)) throw badRequest('Your share is already settled');
    const amount = input.amount ?? remaining;
    if (amount.lte(0) || amount.decimalPlaces() > 2) throw badRequest('Enter an amount greater than 0 with at most 2 decimal places');
    if (amount.gt(remaining)) throw badRequest(`Only ${toAmountText(remaining)} is still unpaid on your share`);
    const claim = await insertClaim(db, expense, userId, amount);
    await notifyExpenseReminder(
        db,
        expense.paid_by,
        `${claim.userName} says they paid`,
        `${claim.userName} paid ${expense.currency} ${toAmountText(amount)} for "${expense.description}". Check your bank or UPI app, then confirm in SplitEase.`,
        expense.group_id,
        expenseId,
    );
    return claim;
}

/**
 * Someone opened a pay link in the browser and tapped "I've paid". The link knows who they are, so this records
 * the same kind of claim for the payer to confirm. A link for a whole group spreads the amount over that
 * person's oldest unpaid expenses first.
 */
export async function claimFromLink(
    db: Db,
    link: { createdBy: string; groupId: string; expenseId?: string; userId: string },
    amount: Decimal | null,
): Promise<{ claimed: number; currency: string | null }> {
    const rows = (
        await db.query(
            `SELECT e.*, s.amount AS share_amount, s.paid_amount AS share_paid
             FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
             WHERE e.group_id = $1 AND e.paid_by = $2 AND s.user_id = $3 AND e.deleted_at IS NULL
               AND s.amount > s.paid_amount AND ($4::uuid IS NULL OR e.id = $4)
             ORDER BY e.expense_date ASC, e.created_at ASC`,
            [link.groupId, link.createdBy, link.userId, link.expenseId ?? null],
        )
    ).rows;
    if (rows.length === 0) throw badRequest('Nothing is left to pay here');
    if (amount !== null && (amount.lte(0) || amount.decimalPlaces() > 2)) {
        throw badRequest('Enter an amount greater than 0 with at most 2 decimal places');
    }
    // Anyone holding the link can tap "I've paid": do not tell the payer again within a minute of the last time.
    const recent = (
        await db.query(
            `SELECT 1 FROM expense_payment_claims c JOIN expenses e ON e.id = c.expense_id
             WHERE c.user_id = $1 AND e.paid_by = $2 AND e.group_id = $3 AND c.created_at > now() - interval '1 minute' LIMIT 1`,
            [link.userId, link.createdBy, link.groupId],
        )
    ).rowCount;
    let left = amount;
    let total = new Decimal(0);
    const names: string[] = [];
    for (const row of rows) {
        const remaining = new Decimal(row.share_amount).minus(row.share_paid);
        const part = left === null ? remaining : Decimal.min(remaining, left);
        if (part.lte(0)) break;
        await insertClaim(db, row, link.userId, part);
        names.push(row.description);
        total = total.plus(part);
        if (left !== null) left = left.minus(part);
        if (left !== null && left.lte(0)) break;
    }
    const who = (await db.query('SELECT display_name FROM users WHERE id = $1', [link.userId])).rows[0]?.display_name ?? 'Someone';
    if (!recent) await notifyExpenseReminder(
        db,
        link.createdBy,
        `${who} says they paid`,
        `${who} marked ${rows[0].currency} ${toAmountText(total)} as paid${names.length === 1 ? ` for "${names[0]}"` : ` across ${names.length} expenses`}. Check your bank or UPI app, then confirm in SplitEase.`,
        link.groupId,
        rows[0].id,
    );
    return { claimed: toJsonNumber(total), currency: rows[0].currency };
}

/** Open claims in a group: the ones waiting on you as the payer, and the ones you made. */
export async function pendingClaims(db: Db, userId: string, groupId: string): Promise<ClaimView[]> {
    await requireMember(db, groupId, userId);
    const rows = (
        await db.query(
            `${CLAIM_SQL}
             WHERE c.group_id = $1 AND c.status = 'PENDING' AND (e.paid_by = $2 OR c.user_id = $2)
             ORDER BY c.created_at DESC`,
            [groupId, userId],
        )
    ).rows;
    return rows.map(view);
}

/** The payer checks whether the money arrived: confirming records the payment, rejecting tells the person it hasn't. */
export async function resolveClaim(db: Db, userId: string, claimId: string, confirm: boolean): Promise<ClaimView> {
    const claim = (
        await db.query('SELECT * FROM expense_payment_claims WHERE id = $1 FOR UPDATE', [claimId])
    ).rows[0];
    if (!claim) throw notFound('Claim not found');
    const row = (await db.query(`${CLAIM_SQL} WHERE c.id = $1`, [claimId])).rows[0];
    if (row.paid_by !== userId) throw forbidden('Only the person who paid can confirm this');
    if (claim.status !== 'PENDING') throw badRequest('This payment was already handled');
    if (confirm) {
        const share = (
            await db.query('SELECT * FROM expense_shares WHERE expense_id = $1 AND user_id = $2', [claim.expense_id, claim.user_id])
        ).rows[0];
        const remaining = share ? new Decimal(share.amount).minus(share.paid_amount) : new Decimal(0);
        const amount = Decimal.min(new Decimal(claim.amount), remaining);
        // If the share was already settled another way, there is nothing more to record.
        if (amount.gt(0)) {
            await recordSharePayment(db, userId, claim.expense_id, { userId: claim.user_id, amount });
        }
    }
    await db.query(
        `UPDATE expense_payment_claims SET status = $1, resolved_at = $2 WHERE id = $3`,
        [confirm ? 'CONFIRMED' : 'REJECTED', new Date(), claimId],
    );
    await notifyExpenseReminder(
        db,
        claim.user_id,
        confirm ? 'Payment confirmed' : 'Payment not received',
        confirm
            ? `Your payment of ${row.currency} ${toAmountText(new Decimal(claim.amount))} for "${row.description}" was confirmed.`
            : `They haven't received your ${row.currency} ${toAmountText(new Decimal(claim.amount))} payment for "${row.description}" yet. Please check and pay again.`,
        claim.group_id,
        claim.expense_id,
    );
    return view((await db.query(`${CLAIM_SQL} WHERE c.id = $1`, [claimId])).rows[0]);
}
