import { Db, db, tx } from '../database';
import { logger } from '../utils/logger';
import { badRequest, forbidden, notFound } from '../utils/errors';
import { composedEmail, queueMail } from './mail.service';
import { notifyExpenseReminder } from './notification.service';

const SWEEP_EVERY_MS = 15 * 60 * 1000;

/**
 * Nudges the payer once an expense has been open for its "auto-remind" period and the group still
 * owes them money in that currency. The app never messages friends itself: the payer gets a
 * notification with the reminder text ready to send.
 */
export async function sendDueReminders(conn: Db = db): Promise<number> {
    const due = (
        await conn.query(
            `SELECT e.id, e.group_id, e.paid_by, e.description, e.amount, e.currency, e.pay_by_date,
                    g.name AS group_name
             FROM expenses e
             JOIN expense_groups g ON g.id = e.group_id
             JOIN group_balances b
               ON b.group_id = e.group_id AND b.user_id = e.paid_by AND b.currency = e.currency
             WHERE e.deleted_at IS NULL
               AND e.remind_after_days IS NOT NULL
               AND e.reminder_sent_at IS NULL
               AND e.created_at + (e.remind_after_days * INTERVAL '1 day') <= now()
               AND b.amount > 0
             ORDER BY e.created_at
             LIMIT 100`,
        )
    ).rows;
    for (const row of due) {
        await tx(async (work) => {
            // Claim the reminder first so two servers never send it twice.
            const claimed = await work.query(
                `UPDATE expenses SET reminder_sent_at = now()
                 WHERE id = $1 AND reminder_sent_at IS NULL`,
                [row.id],
            );
            if (claimed.rowCount === 0) return;
            const lateNote = row.pay_by_date ? ` Pay-by date: ${String(row.pay_by_date).slice(0, 10)}.` : '';
            await notifyExpenseReminder(
                work,
                row.paid_by,
                'Still waiting to settle up',
                `"${row.description}" (${row.currency} ${row.amount}) in ${row.group_name} is still unsettled.${lateNote} ` +
                    `Hi! Just a reminder to settle up for "${row.description}" on SplitEase.`,
                row.group_id,
                row.id,
            );
        });
    }
    return due.length;
}

type ShareReminderKind = 'DUE_SOON' | 'DUE_TODAY' | 'LATE_3' | 'LATE_7';

/** Which reminder is due for a pay-by date: the day before, the day itself, then 3 and 7 days late. */
export function reminderKind(daysUntilDue: number): ShareReminderKind | null {
    if (daysUntilDue === 1) return 'DUE_SOON';
    if (daysUntilDue === 0) return 'DUE_TODAY';
    if (daysUntilDue <= -7) return 'LATE_7';
    if (daysUntilDue <= -3) return 'LATE_3';
    return null;
}

const REMINDER_TEXT: Record<ShareReminderKind, (payer: string, what: string, left: string) => [string, string]> = {
    DUE_SOON: (payer, what, left) => ['Due tomorrow', `${left} for "${what}" is due tomorrow. Pay ${payer} when you can.`],
    DUE_TODAY: (payer, what, left) => ['Due today', `${left} for "${what}" is due today. Pay ${payer} and mark it as paid.`],
    LATE_3: (payer, what, left) => ['A little late', `${left} for "${what}" was due a few days ago. A quick payment to ${payer} will sort it.`],
    LATE_7: (payer, what, left) => ['Still waiting', `${payer} is still waiting for ${left} for "${what}". Please pay when you can.`],
};

/**
 * A gentle nudge to the person who owes, in the app (push and inbox, so it costs nothing): the day before the pay-by
 * date, on it, and again 3 and 7 days late. Each reminder is sent once. People added from contacts have no app, so
 * the payer reminds them by message from the Ledger screen instead.
 */
export async function sendShareReminders(conn: Db = db): Promise<number> {
    const rows = (
        await conn.query(
            `SELECT s.expense_id, s.user_id, e.description, e.currency, e.group_id,
                    (s.amount - s.paid_amount) AS owed,
                    (COALESCE(s.pay_by_date, e.pay_by_date) - CURRENT_DATE) AS days,
                    p.display_name AS payer_name
             FROM expense_shares s
             JOIN expenses e ON e.id = s.expense_id
             JOIN users p ON p.id = e.paid_by
             JOIN users u ON u.id = s.user_id
             WHERE e.deleted_at IS NULL AND s.user_id <> e.paid_by AND s.amount > s.paid_amount
               AND NOT u.is_contact AND u.disabled_at IS NULL
               AND COALESCE(s.pay_by_date, e.pay_by_date) IS NOT NULL
               AND COALESCE(s.pay_by_date, e.pay_by_date) <= CURRENT_DATE + 1
             ORDER BY COALESCE(s.pay_by_date, e.pay_by_date)
             LIMIT 500`,
        )
    ).rows;
    let sent = 0;
    for (const row of rows) {
        const kind = reminderKind(Number(row.days));
        if (!kind) continue;
        await tx(async (work) => {
            const claimed = await work.query(
                `INSERT INTO share_reminders (expense_id, user_id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
                [row.expense_id, row.user_id, kind],
            );
            if (claimed.rowCount === 0) return;
            const [title, message] = REMINDER_TEXT[kind](row.payer_name, row.description, `${row.currency} ${Number(row.owed).toFixed(2)}`);
            await notifyExpenseReminder(work, row.user_id, title, message, row.group_id, row.expense_id);
            sent++;
        });
    }
    return sent;
}

let timer: NodeJS.Timeout | undefined;
let stopped = true;

export function startReminderDispatcher(): void {
    stopped = false;
    const tick = () => {
        Promise.all([sendDueReminders(), sendShareReminders()])
            .catch((error) => logger.error('Expense reminders failed', error))
            .finally(() => {
                if (!stopped) timer = setTimeout(tick, SWEEP_EVERY_MS);
            });
    };
    timer = setTimeout(tick, 60_000);
}

export function stopReminderDispatcher(): void {
    stopped = true;
    if (timer) clearTimeout(timer);
}

export type NudgeChannel = 'PUSH' | 'EMAIL';

/**
 * The payer nudges people who still owe them for an expense, in the app (push / inbox) and/or by
 * email. Only people with something left to pay are contacted; `userIds` narrows it further.
 */
export async function nudgeUnpaid(
    conn: Db,
    userId: string,
    expenseId: string,
    input: { userIds?: string[] | null; channels: NudgeChannel[]; message?: string | null },
): Promise<{ notified: number; emailed: number }> {
    const expense = (await conn.query('SELECT * FROM expenses WHERE id = $1', [expenseId])).rows[0];
    if (!expense || expense.deleted_at !== null) throw notFound('Expense not found');
    if (expense.paid_by !== userId) throw forbidden('Only the payer can send reminders for this expense');
    if (input.channels.length === 0) throw badRequest('Choose at least one way to notify');
    const payer = (await conn.query('SELECT display_name FROM users WHERE id = $1', [userId])).rows[0];
    const group = (await conn.query('SELECT name FROM expense_groups WHERE id = $1', [expense.group_id])).rows[0];
    const owing = (
        await conn.query(
            `SELECT s.user_id, s.amount - s.paid_amount AS left, u.email, u.display_name
             FROM expense_shares s JOIN users u ON u.id = s.user_id
             WHERE s.expense_id = $1 AND s.user_id <> $2 AND s.amount > s.paid_amount
               AND ($3::uuid[] IS NULL OR s.user_id = ANY($3::uuid[]))`,
            [expenseId, userId, input.userIds ?? null],
        )
    ).rows;
    let notified = 0;
    let emailed = 0;
    const payerName = payer?.display_name ?? 'A friend';
    for (const row of owing) {
        const amount = `${expense.currency} ${row.left}`;
        const text =
            input.message?.trim() ||
            `Hi ${row.display_name}, a friendly reminder to settle up ${amount} for "${expense.description}".`;
        if (input.channels.includes('PUSH')) {
            await notifyExpenseReminder(
                conn,
                row.user_id,
                `${payerName} sent a reminder`,
                text,
                expense.group_id,
                expenseId,
            );
            notified++;
        }
        if (input.channels.includes('EMAIL')) {
            await queueMail(
                conn,
                composedEmail({
                    to: row.email,
                    name: row.display_name,
                    subject: `${payerName} sent you a reminder on SplitEase`,
                    heading: 'A friendly reminder',
                    body:
                        `${text}\n\n- Expense: ${expense.description}\n- Group: ${group?.name ?? 'your group'}\n- Still to pay: ${amount}` +
                        (expense.pay_by_date ? `\n- Pay by: ${String(expense.pay_by_date).slice(0, 10)}` : ''),
                }),
                'expense-reminder',
            );
            emailed++;
        }
    }
    return { notified, emailed };
}
