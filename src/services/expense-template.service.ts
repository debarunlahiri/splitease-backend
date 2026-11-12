import { randomUUID } from 'node:crypto';
import { Db } from '../database';
import { notFound } from '../utils/errors';
import { requireMember } from './group.service';

export interface ExpenseTemplateView {
    id: string;
    groupId: string;
    name: string;
    description: string;
    amount: number | null;
    currency: string;
    splitType: string;
    shares: { userId: string; value: number | null }[];
    category: string | null;
    notes: string | null;
    remindAfterDays: number | null;
    createdAt: Date;
}

const MAX_TEMPLATES_PER_GROUP = 30;

function view(row: any): ExpenseTemplateView {
    return { id: row.id, groupId: row.group_id, name: row.name, createdAt: row.created_at, ...row.payload };
}

export async function listTemplates(db: Db, userId: string, groupId: string): Promise<ExpenseTemplateView[]> {
    await requireMember(db, groupId, userId);
    const rows = (
        await db.query(
            'SELECT * FROM expense_templates WHERE user_id = $1 AND group_id = $2 ORDER BY created_at DESC',
            [userId, groupId],
        )
    ).rows;
    return rows.map(view);
}

export async function createTemplate(db: Db, userId: string, input: any): Promise<ExpenseTemplateView> {
    await requireMember(db, input.groupId, userId);
    const existing = (
        await db.query('SELECT id, name FROM expense_templates WHERE user_id = $1 AND group_id = $2', [
            userId,
            input.groupId,
        ])
    ).rows;
    // Saving under an existing name replaces that template.
    const same = existing.find((row: any) => row.name.toLowerCase() === input.name.trim().toLowerCase());
    if (same) await db.query('DELETE FROM expense_templates WHERE id = $1', [same.id]);
    else if (existing.length >= MAX_TEMPLATES_PER_GROUP) {
        await db.query(
            `DELETE FROM expense_templates WHERE id = (
                 SELECT id FROM expense_templates WHERE user_id = $1 AND group_id = $2
                 ORDER BY created_at ASC LIMIT 1)`,
            [userId, input.groupId],
        );
    }
    const payload = {
        description: input.description.trim(),
        amount: input.amount ? input.amount.toNumber() : null,
        currency: input.currency,
        splitType: input.splitType,
        shares: input.shares.map((share: any) => ({
            userId: share.userId,
            value: share.value ? share.value.toNumber() : null,
        })),
        category: input.category ?? null,
        notes: input.notes ?? null,
        remindAfterDays: input.remindAfterDays ?? null,
    };
    const row = (
        await db.query(
            `INSERT INTO expense_templates (id, user_id, group_id, name, payload, created_at)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [randomUUID(), userId, input.groupId, input.name.trim(), JSON.stringify(payload), new Date()],
        )
    ).rows[0];
    return view(row);
}

export async function deleteTemplate(db: Db, userId: string, templateId: string): Promise<void> {
    const result = await db.query('DELETE FROM expense_templates WHERE id = $1 AND user_id = $2', [
        templateId,
        userId,
    ]);
    if (result.rowCount === 0) throw notFound('Template not found');
}
