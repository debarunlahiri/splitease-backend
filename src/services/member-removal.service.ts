import Decimal from 'decimal.js';
import { Db } from '../database';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors';
import { deleteExpense, updateExpense } from './expense.service';
import { memberIds, requireMember, requiredGroup } from './group.service';
import { notifyMembershipChange } from './notification.service';

export interface MemberUsage {
    count: number;
    expenses: { id: string; description: string; amount: string; currency: string; expenseDate: string; paidByThem: boolean }[];
    /** Whether their share can be taken out of those splits automatically and shared among everyone else. */
    canAdjust: boolean;
    /** Why not: they paid for some of the splits, or already paid part of their share back. */
    blockedReason: 'PAID_FOR_SPLITS' | 'HAS_PAYMENTS' | null;
}

/** The live splits in this group that involve [memberId], as the payer or as someone with a share. */
export async function memberUsage(db: Db, userId: string, groupId: string, memberId: string): Promise<MemberUsage> {
    await requireMember(db, groupId, userId);
    const rows = (
        await db.query(
            `SELECT e.id, e.description, e.amount, e.currency, e.expense_date, (e.paid_by = $2) AS paid_by_them,
                    COALESCE((SELECT SUM(s.paid_amount) FROM expense_shares s WHERE s.expense_id = e.id AND s.user_id = $2), 0) AS paid_back
             FROM expenses e
             WHERE e.group_id = $1 AND e.deleted_at IS NULL
               AND (e.paid_by = $2 OR EXISTS (SELECT 1 FROM expense_shares s WHERE s.expense_id = e.id AND s.user_id = $2))
             ORDER BY e.expense_date DESC, e.created_at DESC`,
            [groupId, memberId],
        )
    ).rows;
    const blockedReason = rows.some((r: any) => r.paid_by_them)
        ? 'PAID_FOR_SPLITS'
        : rows.some((r: any) => new Decimal(r.paid_back).gt(0))
          ? 'HAS_PAYMENTS'
          : null;
    return {
        count: rows.length,
        expenses: rows.slice(0, 100).map((r: any) => ({
            id: r.id,
            description: r.description,
            amount: String(r.amount),
            currency: r.currency,
            expenseDate: String(r.expense_date instanceof Date ? r.expense_date.toISOString() : r.expense_date).slice(0, 10),
            paidByThem: Boolean(r.paid_by_them),
        })),
        canAdjust: rows.length > 0 && blockedReason === null,
        blockedReason,
    };
}

/** Shares the total over the people left in proportion to what they already owed; the last person takes the rounding. */
export function redistribute(total: Decimal, owed: Decimal[]): Decimal[] {
    const sum = owed.reduce((a, b) => a.plus(b), new Decimal(0));
    if (sum.lte(0)) {
        const base = total.div(owed.length).toDecimalPlaces(2, Decimal.ROUND_DOWN);
        const rest = total.minus(base.times(owed.length));
        return owed.map((_, i) => (i === 0 ? base.plus(rest) : base));
    }
    let assigned = new Decimal(0);
    return owed.map((amount, i) => {
        const share =
            i === owed.length - 1 ? total.minus(assigned) : total.times(amount).div(sum).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        assigned = assigned.plus(share);
        return share;
    });
}

/**
 * Takes someone out of the group. The group's creator can remove anyone but themselves, and anyone can leave.
 * Someone who is part of splits stays unless [adjust] is set: then their share is taken out of each split and shared
 * among the others, everyone affected is told, and the change shows in each split's history. That is refused when
 * they paid for a split or already paid part of their share back, because those need a decision by a person.
 */
export async function removeMember(
    db: Db,
    userId: string,
    groupId: string,
    memberId: string,
    adjust = false,
): Promise<{ adjusted: number; deleted: number }> {
    const group = await requiredGroup(db, groupId);
    await requireMember(db, groupId, userId);
    if (group.created_by !== userId && memberId !== userId) {
        throw forbidden('Only the person who created this group can remove people');
    }
    if (memberId === group.created_by) throw conflict('The person who created the group cannot be removed');
    if (!(await memberIds(db, groupId)).has(memberId)) throw notFound('This person is not in the group');
    const usage = await memberUsage(db, userId, groupId, memberId);
    if (usage.count > 0 && !adjust) throw conflict('This person is already part of splits in this group');
    if (usage.count > 0 && !usage.canAdjust) {
        throw conflict(
            usage.blockedReason === 'PAID_FOR_SPLITS'
                ? 'This person paid for some of these splits. Delete those splits first.'
                : 'This person has already paid part of these splits, so they cannot be taken out automatically.',
        );
    }

    const names = new Map<string, { name: string; isContact: boolean }>(
        (
            await db.query('SELECT id, display_name, is_contact FROM users WHERE id = ANY($1::uuid[])', [[memberId, userId]])
        ).rows.map((r: any) => [r.id, { name: r.display_name, isContact: r.is_contact }]),
    );
    const removedName = names.get(memberId)?.name ?? 'Someone';
    const affectedUsers = new Set<string>();
    let adjusted = 0;
    let deleted = 0;

    for (const item of usage.expenses.length === usage.count ? usage.expenses : []) {
        const expense = (await db.query('SELECT * FROM expenses WHERE id = $1 AND deleted_at IS NULL', [item.id])).rows[0];
        if (!expense) continue;
        const shares = (
            await db.query(
                'SELECT user_id, amount, pay_by_date FROM expense_shares WHERE expense_id = $1 ORDER BY user_id ASC',
                [item.id],
            )
        ).rows;
        const left = shares.filter((s: any) => s.user_id !== memberId);
        if (left.length === 0) {
            await deleteExpense(db, userId, item.id, { skipEditorCheck: true });
            deleted++;
            affectedUsers.add(expense.paid_by);
            continue;
        }
        const total = new Decimal(expense.amount);
        const amounts = redistribute(total, left.map((s: any) => new Decimal(s.amount)));
        const equal = expense.split_type === 'EQUAL';
        await updateExpense(
            db,
            userId,
            item.id,
            {
                paidBy: expense.paid_by,
                description: expense.description,
                amount: total,
                currency: expense.currency,
                expenseDate: String(expense.expense_date instanceof Date ? expense.expense_date.toISOString() : expense.expense_date).slice(0, 10),
                // Equal stays equal. The others become exact amounts, because the original percentages or shares are not kept.
                splitType: equal ? 'EQUAL' : 'EXACT',
                shares: left.map((s: any, i: number) => ({
                    userId: s.user_id,
                    value: equal ? null : amounts[i],
                    payByDate: s.pay_by_date ? String(s.pay_by_date instanceof Date ? s.pay_by_date.toISOString() : s.pay_by_date).slice(0, 10) : null,
                })),
                category: expense.category,
                notes: expense.notes,
                remindAfterDays: expense.remind_after_days,
                payByDate: expense.pay_by_date ? String(expense.pay_by_date instanceof Date ? expense.pay_by_date.toISOString() : expense.pay_by_date).slice(0, 10) : null,
                receipt: expense.receipt_storage_key
                    ? { name: expense.receipt_name, contentType: expense.receipt_content_type, storageKey: expense.receipt_storage_key }
                    : null,
            },
            { skipEditorCheck: true, quiet: true },
        );
        adjusted++;
        affectedUsers.add(expense.paid_by);
        left.forEach((s: any) => affectedUsers.add(s.user_id));
    }

    await db.query('DELETE FROM group_balances WHERE group_id = $1 AND user_id = $2 AND amount = 0', [groupId, memberId]);
    await db.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, memberId]);
    const stillUsed = (
        await db.query(
            `SELECT 1 WHERE EXISTS (SELECT 1 FROM group_members WHERE user_id = $1)
                OR EXISTS (SELECT 1 FROM expense_shares WHERE user_id = $1)
                OR EXISTS (SELECT 1 FROM expenses WHERE paid_by = $1)
                OR EXISTS (SELECT 1 FROM settlements WHERE payer_id = $1 OR payee_id = $1)
                OR EXISTS (SELECT 1 FROM expense_payment_claims WHERE user_id = $1)`,
            [memberId],
        )
    ).rowCount;
    if (!stillUsed) await db.query('DELETE FROM users WHERE id = $1 AND is_contact', [memberId]);

    // Tell everyone it touched: the people whose shares changed, and the person who was removed.
    const touched = adjusted + deleted;
    if (touched > 0) {
        const plural = touched === 1 ? 'split was' : 'splits were';
        for (const id of affectedUsers) {
            if (id === userId || id === memberId) continue;
            await notifyMembershipChange(
                db,
                id,
                `${removedName} was removed`,
                `${removedName} was removed from ${group.name}. ${touched} ${plural} updated, so your share may have changed. Open ${group.name} to see the new amounts.`,
                groupId,
            );
        }
    }
    if (memberId !== userId && !names.get(memberId)?.isContact) {
        await notifyMembershipChange(
            db,
            memberId,
            `Removed from ${group.name}`,
            touched > 0
                ? `You were removed from ${group.name}. You are no longer part of ${touched} ${touched === 1 ? 'split' : 'splits'} there.`
                : `You were removed from ${group.name}.`,
            groupId,
        );
    }
    return { adjusted, deleted };
}

void badRequest;
