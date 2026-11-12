import ExcelJS from 'exceljs';
import { Db } from '../database';
import { badRequest } from '../utils/errors';
import { toJsonNumber } from '../utils/money';
import { composedEmail, queueMail } from './mail.service';
import { notifyExpenseReminder } from './notification.service';

export interface LedgerSplit {
    expenseId: string;
    groupId: string;
    description: string;
    expenseDate: string;
    currency: string;
    /** What this person still owes on this expense. */
    owed: number;
    /** When it should be paid by (their own date, else the expense's) and whether that has passed. */
    dueDate: string | null;
    overdue: boolean;
}

export interface LedgerPerson {
    userId: string;
    displayName: string;
    photoUrl: string | null;
    /** Totals per currency, so different currencies are never added together. */
    totals: { currency: string; owed: number }[];
    splits: LedgerSplit[];
    /** Money this person says they already paid you and you haven't confirmed yet. */
    claimed: { currency: string; amount: number }[];
}

export interface LedgerView {
    collectedThisMonth: { currency: string; amount: number }[];
    stillPending: { currency: string; amount: number }[];
    people: LedgerPerson[];
    /** What the caller owes other people (the mirror of `people`). */
    youOwe: YouOwePerson[];
    stillToPay: { currency: string; amount: number }[];
}

export interface YouOwePerson {
    userId: string;
    displayName: string;
    photoUrl: string | null;
    /** UPI ID to pay them (INR). */
    upiId: string | null;
    totals: { currency: string; owed: number }[];
    splits: LedgerSplit[];
}

const PENDING_SQL = `
    SELECT s.user_id, u.display_name, u.photo_url, e.id AS expense_id, e.group_id, e.description,
           e.expense_date, e.currency, (s.amount - s.paid_amount) AS owed, e.pay_by_date,
           g.name AS group_name, s.amount, s.paid_amount,
           COALESCE(s.pay_by_date, e.pay_by_date) AS due_date
    FROM expense_shares s
    JOIN expenses e ON e.id = s.expense_id
    JOIN users u ON u.id = s.user_id
    JOIN expense_groups g ON g.id = e.group_id
    WHERE e.paid_by = $1 AND e.deleted_at IS NULL AND s.user_id <> $1 AND s.amount > s.paid_amount`;

/** What other people owe the caller on expenses the caller paid, and what arrived this month. */
export async function ledger(db: Db, userId: string): Promise<LedgerView> {
    const rows = (await db.query(`${PENDING_SQL} ORDER BY u.display_name, e.expense_date DESC`, [userId])).rows;
    const people = new Map<string, LedgerPerson>();
    const pending = new Map<string, number>();
    for (const row of rows) {
        const owed = toJsonNumber(row.owed);
        let person = people.get(row.user_id);
        if (!person) {
            person = {
                userId: row.user_id,
                displayName: row.display_name,
                photoUrl: row.photo_url,
                totals: [],
                splits: [],
                claimed: [],
            };
            people.set(row.user_id, person);
        }
        const total = person.totals.find((t) => t.currency === row.currency);
        if (total) total.owed = round(total.owed + owed);
        else person.totals.push({ currency: row.currency, owed });
        person.splits.push({
            expenseId: row.expense_id,
            groupId: row.group_id,
            description: row.description,
            expenseDate: row.expense_date,
            currency: row.currency,
            owed,
            dueDate: dueText(row.due_date),
            overdue: isOverdue(row.due_date),
        });
        pending.set(row.currency, round((pending.get(row.currency) ?? 0) + owed));
    }
    const claimRows = (
        await db.query(
            `SELECT c.user_id, e.currency, SUM(c.amount) AS amount
             FROM expense_payment_claims c JOIN expenses e ON e.id = c.expense_id
             WHERE c.status = 'PENDING' AND e.paid_by = $1 AND e.deleted_at IS NULL
             GROUP BY c.user_id, e.currency`,
            [userId],
        )
    ).rows;
    for (const claim of claimRows) {
        people.get(claim.user_id)?.claimed.push({ currency: claim.currency, amount: toJsonNumber(claim.amount) });
    }
    const owe = (
        await db.query(
            `SELECT e.paid_by AS payee_id, u.display_name, u.photo_url, u.upi_id, e.id AS expense_id, e.group_id,
                    e.description, e.expense_date, e.currency, (s.amount - s.paid_amount) AS owed,
                    COALESCE(s.pay_by_date, e.pay_by_date) AS due_date
             FROM expense_shares s
             JOIN expenses e ON e.id = s.expense_id
             JOIN users u ON u.id = e.paid_by
             WHERE s.user_id = $1 AND e.paid_by <> $1 AND e.deleted_at IS NULL AND s.amount > s.paid_amount
             ORDER BY COALESCE(s.pay_by_date, e.pay_by_date) ASC NULLS LAST, e.expense_date DESC`,
            [userId],
        )
    ).rows;
    const payees = new Map<string, YouOwePerson>();
    const stillToPay = new Map<string, number>();
    for (const row of owe) {
        const owed = toJsonNumber(row.owed);
        let payee = payees.get(row.payee_id);
        if (!payee) {
            payee = {
                userId: row.payee_id,
                displayName: row.display_name,
                photoUrl: row.photo_url,
                upiId: row.upi_id ?? null,
                totals: [],
                splits: [],
            };
            payees.set(row.payee_id, payee);
        }
        const total = payee.totals.find((t) => t.currency === row.currency);
        if (total) total.owed = round(total.owed + owed);
        else payee.totals.push({ currency: row.currency, owed });
        payee.splits.push({
            expenseId: row.expense_id,
            groupId: row.group_id,
            description: row.description,
            expenseDate: row.expense_date,
            currency: row.currency,
            owed,
            dueDate: dueText(row.due_date),
            overdue: isOverdue(row.due_date),
        });
        stillToPay.set(row.currency, round((stillToPay.get(row.currency) ?? 0) + owed));
    }
    const collected = (
        await db.query(
            `SELECT currency, SUM(amount) AS amount FROM settlements
             WHERE payee_id = $1 AND created_at >= date_trunc('month', now())
             GROUP BY currency ORDER BY currency`,
            [userId],
        )
    ).rows;
    return {
        collectedThisMonth: collected.map((row: any) => ({ currency: row.currency, amount: toJsonNumber(row.amount) })),
        stillPending: [...pending].map(([currency, amount]) => ({ currency, amount })),
        // Biggest debts first.
        youOwe: [...payees.values()],
        stillToPay: [...stillToPay].map(([currency, amount]) => ({ currency, amount })),
        people: [...people.values()].sort(
            (a, b) => Math.max(...b.totals.map((t) => t.owed)) - Math.max(...a.totals.map((t) => t.owed)),
        ),
    };
}

function dueText(value: unknown): string | null {
    if (!value) return null;
    return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function isOverdue(value: unknown): boolean {
    const due = dueText(value);
    return due !== null && due < new Date().toISOString().slice(0, 10);
}

function round(value: number): number {
    return Math.round(value * 100) / 100;
}

function csvCell(value: unknown): string {
    let text = value === null || value === undefined ? '' : String(value);
    // Stop spreadsheet apps from running text that starts like a formula.
    // (Phone numbers such as +91 98765 43210 are left alone.)
    if (/^[=@\t\r]/.test(text) || (/^[+\-]/.test(text) && !/^[+\-]?[\d\s().-]+$/.test(text))) text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The ledger as CSV: a money summary per currency, every share on expenses the caller paid (paid and
 * unpaid), and every payment the caller received, so the sheet shows all the money in and out.
 */
export type ExportScope = 'all' | 'owed' | 'owe';

/** `owed` = money others owe you, `owe` = money you owe others, `all` = both. */
async function ledgerExportData(db: Db, userId: string, scope: ExportScope) {
    const owed = scope === 'owe'
        ? []
        : (
              await db.query(
                  `SELECT s.user_id, u.display_name, u.email, u.is_contact, u.contact_email, u.contact_phone,
                          e.description, e.expense_date, e.currency,
                          COALESCE(s.pay_by_date, e.pay_by_date) AS pay_by_date, g.name AS group_name, s.amount, s.paid_amount
                   FROM expense_shares s
                   JOIN expenses e ON e.id = s.expense_id
                   JOIN users u ON u.id = s.user_id
                   JOIN expense_groups g ON g.id = e.group_id
                   WHERE e.paid_by = $1 AND e.deleted_at IS NULL AND s.user_id <> $1
                   ORDER BY e.expense_date DESC, e.created_at DESC, u.display_name`,
                  [userId],
              )
          ).rows;
    const received = scope === 'owe'
        ? []
        : (
              await db.query(
                  `SELECT t.created_at, t.amount, t.currency, t.note, u.display_name, g.name AS group_name
                   FROM settlements t
                   JOIN users u ON u.id = t.payer_id
                   JOIN expense_groups g ON g.id = t.group_id
                   WHERE t.payee_id = $1
                   ORDER BY t.created_at DESC`,
                  [userId],
              )
          ).rows;
    const owe = scope === 'owed'
        ? []
        : (
              await db.query(
                  `SELECT u.display_name, u.upi_id, e.description, e.expense_date, e.currency,
                          COALESCE(s.pay_by_date, e.pay_by_date) AS pay_by_date, g.name AS group_name, s.amount, s.paid_amount
                   FROM expense_shares s
                   JOIN expenses e ON e.id = s.expense_id
                   JOIN users u ON u.id = e.paid_by
                   JOIN expense_groups g ON g.id = e.group_id
                   WHERE s.user_id = $1 AND e.paid_by <> $1 AND e.deleted_at IS NULL
                   ORDER BY e.expense_date DESC, e.created_at DESC`,
                  [userId],
              )
          ).rows;
    const made = scope === 'owed'
        ? []
        : (
              await db.query(
                  `SELECT t.created_at, t.amount, t.currency, t.note, u.display_name, g.name AS group_name
                   FROM settlements t
                   JOIN users u ON u.id = t.payee_id
                   JOIN expense_groups g ON g.id = t.group_id
                   WHERE t.payer_id = $1
                   ORDER BY t.created_at DESC`,
                  [userId],
              )
          ).rows;
    return { owed, received, owe, made };
}

const statusOf = (amount: unknown, paid: unknown) => {
    const left = Number(amount) - Number(paid);
    return left <= 0 ? 'PAID' : Number(paid) > 0 ? 'PARTIAL' : 'UNPAID';
};

/** Per-currency totals: how much was shared, how much is paid, and money that moved this month / ever. */
function summaryRows(shares: any[], moved: any[]) {
    const totals = new Map<string, { shared: number; paid: number }>();
    for (const row of shares) {
        const t = totals.get(row.currency) ?? { shared: 0, paid: 0 };
        t.shared += Number(row.amount);
        t.paid += Number(row.paid_amount);
        totals.set(row.currency, t);
    }
    const all = new Map<string, number>();
    const month = new Map<string, number>();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    for (const row of moved) {
        all.set(row.currency, (all.get(row.currency) ?? 0) + Number(row.amount));
        if (new Date(row.created_at) >= monthStart) month.set(row.currency, (month.get(row.currency) ?? 0) + Number(row.amount));
    }
    return [...new Set([...totals.keys(), ...all.keys()])].sort().map((currency) => {
        const t = totals.get(currency) ?? { shared: 0, paid: 0 };
        return {
            currency,
            shared: t.shared,
            paid: t.paid,
            pending: Math.max(t.shared - t.paid, 0),
            movedAll: all.get(currency) ?? 0,
            movedMonth: month.get(currency) ?? 0,
        };
    });
}

/**
 * The ledger as CSV. `scope` picks what goes in: what others owe you (`owed`), what you owe (`owe`), or both (`all`),
 * each with a money summary and the payments that moved.
 */
export async function exportLedgerCsv(db: Db, userId: string, scope: ExportScope = 'all'): Promise<string> {
    const { owed, received, owe, made } = await ledgerExportData(db, userId, scope);
    const line = (cells: unknown[]) => cells.map(csvCell).join(',');
    const out: string[] = [];
    const block = (title: string) => {
        if (out.length) out.push('');
        out.push(line([title]));
    };
    if (scope !== 'owe') {
        block('SUMMARY · OWED TO YOU');
        out.push(line(['Currency', 'Total shared with others', 'Paid back on these expenses', 'Still pending', 'Received (all time)', 'Received this month']));
        for (const r of summaryRows(owed, received)) {
            out.push(line([r.currency, r.shared.toFixed(2), r.paid.toFixed(2), r.pending.toFixed(2), r.movedAll.toFixed(2), r.movedMonth.toFixed(2)]));
        }
        block('WHO OWES YOU');
        out.push(line(['Date', 'Group', 'Expense', 'Person', 'Type', 'Email', 'Phone', 'Currency', 'Share', 'Paid', 'Pending', 'Status', 'Pay by']));
        for (const row of owed) {
            const left = Number(row.amount) - Number(row.paid_amount);
            out.push(
                line([
                    String(row.expense_date).slice(0, 10), row.group_name, row.description, row.display_name,
                    row.is_contact ? 'Contact' : 'Member',
                    row.is_contact ? (row.contact_email ?? '') : row.email,
                    row.is_contact ? (row.contact_phone ?? '') : '',
                    row.currency, Number(row.amount).toFixed(2), Number(row.paid_amount).toFixed(2),
                    Math.max(left, 0).toFixed(2), statusOf(row.amount, row.paid_amount),
                    row.pay_by_date ? String(row.pay_by_date).slice(0, 10) : '',
                ]),
            );
        }
        block('PAYMENTS RECEIVED');
        out.push(line(['Date', 'Group', 'From', 'Currency', 'Amount', 'Note']));
        for (const row of received) {
            out.push(line([new Date(row.created_at).toISOString().slice(0, 10), row.group_name, row.display_name, row.currency, Number(row.amount).toFixed(2), row.note ?? '']));
        }
    }
    if (scope !== 'owed') {
        block('SUMMARY · YOU OWE');
        out.push(line(['Currency', 'Total you owe', 'Paid so far', 'Still to pay', 'Paid out (all time)', 'Paid out this month']));
        for (const r of summaryRows(owe, made)) {
            out.push(line([r.currency, r.shared.toFixed(2), r.paid.toFixed(2), r.pending.toFixed(2), r.movedAll.toFixed(2), r.movedMonth.toFixed(2)]));
        }
        block('WHAT YOU OWE');
        out.push(line(['Date', 'Group', 'Expense', 'Pay to', 'UPI ID', 'Currency', 'Share', 'Paid', 'Pending', 'Status', 'Due']));
        for (const row of owe) {
            const left = Number(row.amount) - Number(row.paid_amount);
            out.push(
                line([
                    String(row.expense_date).slice(0, 10), row.group_name, row.description, row.display_name, row.upi_id ?? '',
                    row.currency, Number(row.amount).toFixed(2), Number(row.paid_amount).toFixed(2),
                    Math.max(left, 0).toFixed(2), statusOf(row.amount, row.paid_amount),
                    row.pay_by_date ? String(row.pay_by_date).slice(0, 10) : '',
                ]),
            );
        }
        block('PAYMENTS YOU MADE');
        out.push(line(['Date', 'Group', 'To', 'Currency', 'Amount', 'Note']));
        for (const row of made) {
            out.push(line([new Date(row.created_at).toISOString().slice(0, 10), row.group_name, row.display_name, row.currency, Number(row.amount).toFixed(2), row.note ?? '']));
        }
    }
    return out.join('\r\n') + '\r\n';
}

/** One reminder covering everything a person still owes the caller, instead of one per expense. */
export async function remindPerson(
    db: Db,
    userId: string,
    personId: string,
    channels: ('PUSH' | 'EMAIL')[],
): Promise<{ notified: number; emailed: number; splits: number }> {
    if (channels.length === 0) throw badRequest('Choose at least one way to notify');
    const rows = (await db.query(`${PENDING_SQL} AND s.user_id = $2 ORDER BY e.expense_date DESC`, [userId, personId])).rows;
    if (rows.length === 0) return { notified: 0, emailed: 0, splits: 0 };
    const me = (await db.query('SELECT display_name FROM users WHERE id = $1', [userId])).rows[0];
    const person = (await db.query('SELECT email, display_name FROM users WHERE id = $1', [personId])).rows[0];
    const totals = new Map<string, number>();
    for (const row of rows) totals.set(row.currency, round((totals.get(row.currency) ?? 0) + Number(row.owed)));
    const totalText = [...totals].map(([currency, amount]) => `${currency} ${amount.toFixed(2)}`).join(' + ');
    const list = rows.map((row: any) => `- ${row.description}: ${row.currency} ${Number(row.owed).toFixed(2)}`);
    const myName = me?.display_name ?? 'A friend';
    const text = `Hi ${person.display_name}, a friendly reminder: you have ${rows.length} unsettled ${rows.length === 1 ? 'split' : 'splits'} with ${myName} totalling ${totalText}.`;
    let notified = 0;
    let emailed = 0;
    if (channels.includes('PUSH')) {
        await notifyExpenseReminder(db, personId, `${myName} sent a reminder`, text, rows[0].group_id, rows[0].expense_id);
        notified = 1;
    }
    if (channels.includes('EMAIL')) {
        await queueMail(
            db,
            composedEmail({
                to: person.email,
                name: person.display_name,
                subject: `${myName} sent you a reminder on SplitEase`,
                heading: 'A friendly reminder',
                body: `${text}\n\n${list.join('\n')}`,
            }),
            'ledger-reminder',
        );
        emailed = 1;
    }
    return { notified, emailed, splits: rows.length };
}

export interface GroupProgress {
    groupId: string;
    /** People-shares (excluding the payer's own) fully paid, and how many there are. */
    settled: number;
    total: number;
    /** Money still to be paid back in this group, per currency (everyone's shares together). */
    pending: { currency: string; amount: number }[];
    /** Money already paid back, per currency. */
    collected: { currency: string; amount: number }[];
}

export interface ProgressView {
    /** Across all groups: what others still owe you, and what you still owe others. */
    toCollect: { currency: string; amount: number }[];
    toPay: { currency: string; amount: number }[];
    groups: GroupProgress[];
}

/** How far along settling up is in each of the caller's groups, and overall. */
export async function progress(db: Db, userId: string): Promise<ProgressView> {
    const rows = (
        await db.query(
            `SELECT e.group_id, e.currency,
                    COUNT(*) FILTER (WHERE s.user_id <> e.paid_by) AS total,
                    COUNT(*) FILTER (WHERE s.user_id <> e.paid_by AND s.paid_amount >= s.amount) AS settled,
                    COALESCE(SUM(s.amount - s.paid_amount) FILTER (WHERE s.user_id <> e.paid_by), 0) AS pending,
                    COALESCE(SUM(s.paid_amount) FILTER (WHERE s.user_id <> e.paid_by), 0) AS collected,
                    COALESCE(SUM(s.amount - s.paid_amount) FILTER (WHERE e.paid_by = $1 AND s.user_id <> $1), 0) AS to_collect,
                    COALESCE(SUM(s.amount - s.paid_amount) FILTER (WHERE s.user_id = $1 AND e.paid_by <> $1), 0) AS to_pay
             FROM expense_shares s
             JOIN expenses e ON e.id = s.expense_id
             WHERE e.deleted_at IS NULL
               AND e.group_id IN (SELECT group_id FROM group_members WHERE user_id = $1)
             GROUP BY e.group_id, e.currency`,
            [userId],
        )
    ).rows;
    const groups = new Map<string, GroupProgress>();
    const toCollect = new Map<string, number>();
    const toPay = new Map<string, number>();
    for (const row of rows) {
        let group = groups.get(row.group_id);
        if (!group) {
            group = { groupId: row.group_id, settled: 0, total: 0, pending: [], collected: [] };
            groups.set(row.group_id, group);
        }
        group.total += Number(row.total);
        group.settled += Number(row.settled);
        if (Number(row.pending) > 0) group.pending.push({ currency: row.currency, amount: toJsonNumber(row.pending) });
        if (Number(row.collected) > 0) group.collected.push({ currency: row.currency, amount: toJsonNumber(row.collected) });
        if (Number(row.to_collect) > 0) toCollect.set(row.currency, round((toCollect.get(row.currency) ?? 0) + Number(row.to_collect)));
        if (Number(row.to_pay) > 0) toPay.set(row.currency, round((toPay.get(row.currency) ?? 0) + Number(row.to_pay)));
    }
    const list = (map: Map<string, number>) => [...map].map(([currency, amount]) => ({ currency, amount }));
    return { toCollect: list(toCollect), toPay: list(toPay), groups: [...groups.values()] };
}

// ------------------------------------------------------------------ Excel export

const GREEN = 'FF174B3D';
const BLUE = 'FF1F4E79';
const MINT = 'FFE6F0E7';

/**
 * The ledger as a formatted Excel workbook. `scope` picks the sheets: `owed` (money others owe you), `owe` (money you
 * owe) or `all`. Amounts are real numbers with a currency format; status and overdue dates are colour-coded.
 */
export async function exportLedgerXlsx(db: Db, userId: string, scope: ExportScope = 'all'): Promise<Buffer> {
    const { owed, received, owe, made } = await ledgerExportData(db, userId, scope);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SplitEase';
    workbook.created = new Date();
    const money = (currency: string) => (currency === 'INR' ? '[$₹-4009] #,##0.00' : `"${currency}" #,##0.00`);
    const today = new Date().toISOString().slice(0, 10);
    const border = { style: 'thin' as const, color: { argb: 'FFDBE4DA' } };
    const frame = (row: ExcelJS.Row) => row.eachCell((cell) => (cell.border = { top: border, bottom: border, left: border, right: border }));
    const header = (row: ExcelJS.Row, colour: string) => {
        row.height = 22;
        row.eachCell((cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colour } };
            cell.alignment = { vertical: 'middle', horizontal: 'left' };
        });
    };
    const fill = (cell: ExcelJS.Cell, argb: string) => (cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } });
    const status = (cell: ExcelJS.Cell, value: string) => {
        const colours: Record<string, [string, string]> = {
            PAID: ['FFD9F4D2', 'FF1B5E20'],
            PARTIAL: ['FFFFF1C9', 'FF8A5A00'],
            UNPAID: ['FFFBDADA', 'FF9B1C1C'],
        };
        const [bg, fg] = colours[value] ?? ['FFFFFFFF', 'FF000000'];
        fill(cell, bg);
        cell.font = { bold: true, color: { argb: fg } };
        cell.alignment = { horizontal: 'center' };
    };
    const summary = (sheet: ExcelJS.Worksheet, title: string, labels: string[], rows: ReturnType<typeof summaryRows>, colour: string) => {
        const t = sheet.addRow([title]);
        t.getCell(1).font = { bold: true, size: 13, color: { argb: colour } };
        const h = sheet.addRow(['Currency', ...labels]);
        header(h, colour);
        for (const r of rows) {
            const row = sheet.addRow([r.currency, r.shared, r.paid, r.pending, r.movedAll, r.movedMonth]);
            for (let c = 2; c <= 6; c++) row.getCell(c).numFmt = money(r.currency);
            row.getCell(1).font = { bold: true };
            row.getCell(4).font = { bold: true, color: { argb: r.pending > 0 ? 'FF9B1C1C' : 'FF1B5E20' } };
            fill(row.getCell(4), r.pending > 0 ? 'FFFBDADA' : 'FFD9F4D2');
            row.getCell(5).font = { bold: true, color: { argb: 'FF1B5E20' } };
            frame(row);
        }
        sheet.addRow([]);
    };
    const detail = (name: string, columns: { header: string; width: number }[], colour: string) => {
        const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
        sheet.columns = columns;
        header(sheet.getRow(1), colour);
        sheet.autoFilter = { from: 'A1', to: { row: 1, column: columns.length } };
        return sheet;
    };

    // ---- Summary
    const sum = workbook.addWorksheet('Summary', { views: [{ showGridLines: false }] });
    sum.columns = [{ width: 12 }, { width: 26 }, { width: 28 }, { width: 18 }, { width: 22 }, { width: 24 }];
    if (scope !== 'owe') {
        summary(sum, 'Owed to you', ['Total shared with others', 'Paid back on these expenses', 'Still pending', 'Received (all time)', 'Received this month'], summaryRows(owed, received), GREEN);
    }
    if (scope !== 'owed') {
        summary(sum, 'You owe', ['Total you owe', 'Paid so far', 'Still to pay', 'Paid out (all time)', 'Paid out this month'], summaryRows(owe, made), BLUE);
    }

    // ---- Owed to you
    if (scope !== 'owe') {
        const sheet = detail('Who owes you', [
            { header: 'Date', width: 12 }, { header: 'Group', width: 20 }, { header: 'Expense', width: 24 },
            { header: 'Person', width: 22 }, { header: 'Type', width: 10 }, { header: 'Email', width: 30 },
            { header: 'Phone', width: 16 }, { header: 'Currency', width: 10 }, { header: 'Share', width: 14 },
            { header: 'Paid', width: 14 }, { header: 'Pending', width: 14 }, { header: 'Status', width: 11 }, { header: 'Pay by', width: 13 },
        ], GREEN);
        owed.forEach((r: any, index: number) => {
            const left = Number(r.amount) - Number(r.paid_amount);
            const due = r.pay_by_date ? String(r.pay_by_date).slice(0, 10) : '';
            const row = sheet.addRow([
                String(r.expense_date).slice(0, 10), r.group_name, r.description, r.display_name,
                r.is_contact ? 'Contact' : 'Member',
                r.is_contact ? (r.contact_email ?? '') : r.email,
                r.is_contact ? (r.contact_phone ?? '') : '',
                r.currency, Number(r.amount), Number(r.paid_amount), Math.max(left, 0), statusOf(r.amount, r.paid_amount), due,
            ]);
            if (index % 2 === 1) row.eachCell((cell) => fill(cell, 'FFF6F9F4'));
            for (const c of [9, 10, 11]) row.getCell(c).numFmt = money(r.currency);
            row.getCell(5).font = { color: { argb: r.is_contact ? 'FF8A5A00' : 'FF51635C' } };
            row.getCell(11).font = { bold: true, color: { argb: left > 0 ? 'FF9B1C1C' : 'FF1B5E20' } };
            status(row.getCell(12), statusOf(r.amount, r.paid_amount));
            if (due && due < today && left > 0) {
                row.getCell(13).font = { bold: true, color: { argb: 'FFFFFFFF' } };
                fill(row.getCell(13), 'FFB3261E');
            }
            frame(row);
        });
        const paid = detail('Payments received', [
            { header: 'Date', width: 12 }, { header: 'Group', width: 20 }, { header: 'From', width: 24 },
            { header: 'Currency', width: 10 }, { header: 'Amount', width: 16 }, { header: 'Note', width: 36 },
        ], GREEN);
        for (const r of received as any[]) {
            const row = paid.addRow([new Date(r.created_at).toISOString().slice(0, 10), r.group_name, r.display_name, r.currency, Number(r.amount), r.note ?? '']);
            row.getCell(5).numFmt = money(r.currency);
            row.getCell(5).font = { bold: true, color: { argb: 'FF1B5E20' } };
            fill(row.getCell(5), MINT);
            frame(row);
        }
    }

    // ---- You owe
    if (scope !== 'owed') {
        const sheet = detail('What you owe', [
            { header: 'Date', width: 12 }, { header: 'Group', width: 20 }, { header: 'Expense', width: 24 },
            { header: 'Pay to', width: 22 }, { header: 'UPI ID', width: 26 }, { header: 'Currency', width: 10 },
            { header: 'Share', width: 14 }, { header: 'Paid', width: 14 }, { header: 'Pending', width: 14 },
            { header: 'Status', width: 11 }, { header: 'Due', width: 13 },
        ], BLUE);
        owe.forEach((r: any, index: number) => {
            const left = Number(r.amount) - Number(r.paid_amount);
            const due = r.pay_by_date ? String(r.pay_by_date).slice(0, 10) : '';
            const row = sheet.addRow([
                String(r.expense_date).slice(0, 10), r.group_name, r.description, r.display_name, r.upi_id ?? '',
                r.currency, Number(r.amount), Number(r.paid_amount), Math.max(left, 0), statusOf(r.amount, r.paid_amount), due,
            ]);
            if (index % 2 === 1) row.eachCell((cell) => fill(cell, 'FFF3F7FB'));
            for (const c of [7, 8, 9]) row.getCell(c).numFmt = money(r.currency);
            row.getCell(9).font = { bold: true, color: { argb: left > 0 ? 'FF9B1C1C' : 'FF1B5E20' } };
            status(row.getCell(10), statusOf(r.amount, r.paid_amount));
            if (due && due < today && left > 0) {
                row.getCell(11).font = { bold: true, color: { argb: 'FFFFFFFF' } };
                fill(row.getCell(11), 'FFB3261E');
            }
            frame(row);
        });
        const out = detail('Payments you made', [
            { header: 'Date', width: 12 }, { header: 'Group', width: 20 }, { header: 'To', width: 24 },
            { header: 'Currency', width: 10 }, { header: 'Amount', width: 16 }, { header: 'Note', width: 36 },
        ], BLUE);
        for (const r of made as any[]) {
            const row = out.addRow([new Date(r.created_at).toISOString().slice(0, 10), r.group_name, r.display_name, r.currency, Number(r.amount), r.note ?? '']);
            row.getCell(5).numFmt = money(r.currency);
            row.getCell(5).font = { bold: true, color: { argb: BLUE } };
            fill(row.getCell(5), 'FFE3EDF7');
            frame(row);
        }
    }
    return Buffer.from(await workbook.xlsx.writeBuffer());
}
