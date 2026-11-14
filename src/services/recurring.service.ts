import { randomUUID } from 'node:crypto';
import { Db, db, tx } from '../database';
import { logger } from '../utils/logger';
import { badRequest, forbidden, notFound } from '../utils/errors';
import { parseBody } from '../validators/common';
import { CreateExpense } from '../validators/expense.validator';
import { createExpense } from './expense.service';
import { requireMember } from './group.service';

export type Frequency = 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface RecurringView {
    id: string;
    groupId: string;
    frequency: Frequency;
    nextRunOn: string;
    endsOn: string | null;
    active: boolean;
    runs: number;
    createdBy: string;
    description: string;
    amount: string;
    currency: string;
    splitType: string;
    paidBy: string;
    shareCount: number;
}

const day = (value: unknown) => String(value instanceof Date ? value.toISOString() : value).slice(0, 10);

/** The date after [from] for this schedule. Monthly and yearly keep returning to [anchorDay], clamped to short months. */
export function nextDate(from: string, frequency: Frequency, anchorDay: number): string {
    const [y, m, d] = from.split('-').map(Number);
    if (frequency === 'WEEKLY') {
        const next = new Date(Date.UTC(y, m - 1, d + 7));
        return next.toISOString().slice(0, 10);
    }
    const months = frequency === 'MONTHLY' ? 1 : 12;
    const target = new Date(Date.UTC(y, m - 1 + months, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(anchorDay, lastDay));
    return target.toISOString().slice(0, 10);
}

function view(row: any): RecurringView {
    const t = row.template;
    return {
        id: row.id,
        groupId: row.group_id,
        frequency: row.frequency,
        nextRunOn: day(row.next_run_on),
        endsOn: row.ends_on ? day(row.ends_on) : null,
        active: row.active,
        runs: row.runs,
        createdBy: row.created_by,
        description: String(t.description ?? ''),
        amount: String(t.amount ?? ''),
        currency: String(t.currency ?? ''),
        splitType: String(t.splitType ?? ''),
        paidBy: String(t.paidBy ?? ''),
        shareCount: Array.isArray(t.shares) ? t.shares.length : 0,
    };
}

export async function createRecurring(
    conn: Db,
    userId: string,
    input: { groupId: string; frequency: Frequency; startOn: string; endsOn: string | null; expense: Record<string, unknown> },
): Promise<RecurringView> {
    await requireMember(conn, input.groupId, userId);
    if (input.endsOn && input.endsOn < input.startOn) throw badRequest('The end date must be after the start date');
    // Check it as a normal expense now, so a repeat that could never be created is refused up front.
    const checked = parseBody(CreateExpense, { ...input.expense, groupId: input.groupId, expenseDate: input.startOn });
    if (checked.paidBy !== userId) throw badRequest('The payer must be the authenticated user');
    const { attachmentIds: _a, receipt: _r, expenseDate: _d, payByDate: _p, ...template } = input.expense as Record<string, unknown>;
    const anchor = Number(input.startOn.slice(8, 10));
    const row = (
        await conn.query(
            `INSERT INTO recurring_expenses (id, group_id, created_by, frequency, next_run_on, anchor_day, ends_on, template)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [randomUUID(), input.groupId, userId, input.frequency, input.startOn, anchor, input.endsOn, JSON.stringify(template)],
        )
    ).rows[0];
    return view(row);
}

export async function listRecurring(conn: Db, userId: string, groupId: string): Promise<RecurringView[]> {
    await requireMember(conn, groupId, userId);
    const rows = (
        await conn.query('SELECT * FROM recurring_expenses WHERE group_id = $1 ORDER BY active DESC, next_run_on ASC', [groupId])
    ).rows;
    return rows.map(view);
}

async function owned(conn: Db, userId: string, id: string) {
    const row = (await conn.query('SELECT * FROM recurring_expenses WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!row) throw notFound('Repeating split not found');
    if (row.created_by !== userId) throw forbidden('Only the person who set this up can change it');
    return row;
}

export async function setRecurringActive(conn: Db, userId: string, id: string, active: boolean): Promise<RecurringView> {
    const row = await owned(conn, userId, id);
    // Resuming never creates the splits that were missed while paused: the next one is the next upcoming date.
    let next = day(row.next_run_on);
    const today = new Date().toISOString().slice(0, 10);
    while (active && next < today) next = nextDate(next, row.frequency, row.anchor_day);
    const updated = (
        await conn.query('UPDATE recurring_expenses SET active = $1, next_run_on = $2 WHERE id = $3 RETURNING *', [active, next, id])
    ).rows[0];
    return view(updated);
}

export async function deleteRecurring(conn: Db, userId: string, id: string): Promise<void> {
    await owned(conn, userId, id);
    await conn.query('DELETE FROM recurring_expenses WHERE id = $1', [id]);
}

/** Creates the split for every repeat that is due today or earlier (each missed date once, up to a few). */
export async function runDueRecurring(): Promise<number> {
    let created = 0;
    const today = new Date().toISOString().slice(0, 10);
    for (let guard = 0; guard < 200; guard++) {
        const done = await tx(async (work) => {
            const row = (
                await work.query(
                    `SELECT * FROM recurring_expenses WHERE active AND next_run_on <= $1
                     ORDER BY next_run_on LIMIT 1 FOR UPDATE SKIP LOCKED`,
                    [today],
                )
            ).rows[0];
            if (!row) return false;
            const runOn = day(row.next_run_on);
            let next = nextDate(runOn, row.frequency, row.anchor_day);
            let stillActive = !(row.ends_on && next > day(row.ends_on));
            try {
                const input = parseBody(CreateExpense, { ...row.template, groupId: row.group_id, expenseDate: runOn });
                await createExpense(work, row.created_by, input);
                created++;
            } catch (error) {
                // Someone left the group or the split no longer adds up: stop repeating instead of failing every day.
                logger.warn(`Repeating split ${row.id} paused: ${(error as Error).message}`);
                stillActive = false;
            }
            await work.query(
                `UPDATE recurring_expenses SET next_run_on = $2, last_run_on = $3, runs = runs + 1, active = $4 WHERE id = $1`,
                [row.id, next, runOn, stillActive],
            );
            return true;
        });
        if (!done) break;
    }
    return created;
}

let timer: NodeJS.Timeout | undefined;
let stopped = true;
const EVERY_MS = 60 * 60 * 1000;

export function startRecurringDispatcher(): void {
    stopped = false;
    const tick = () => {
        runDueRecurring()
            .then((n) => n > 0 && logger.info(`Created ${n} repeating split(s)`))
            .catch((error) => logger.error('Repeating splits failed', error))
            .finally(() => {
                if (!stopped) timer = setTimeout(tick, EVERY_MS);
            });
    };
    timer = setTimeout(tick, 90_000);
}

export function stopRecurringDispatcher(): void {
    stopped = true;
    if (timer) clearTimeout(timer);
}
void db;
