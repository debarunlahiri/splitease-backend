import { advisoryLock, Db } from '../database';
import { badRequest, conflict, notFound, tooManyRequests } from '../utils/errors';
import { requireMember } from './group.service';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export interface AttachmentView {
    id: string;
    name: string;
    contentType: string;
}

export async function stageAttachment(
    db: Db,
    groupId: string,
    userId: string,
    id: string,
    name: string,
    contentType: string,
    data: Buffer,
): Promise<void> {
    if (!name.trim() || name.length > 255 || /[\u0000-\u001f\u007f/\\]/.test(name)) {
        throw badRequest('Invalid attachment filename');
    }
    if (contentType.length > 120 || !/^[\w.+-]+\/[\w.+-]+$/.test(contentType)) {
        throw badRequest('Invalid attachment type');
    }
    if (!Buffer.isBuffer(data) || data.length === 0 || data.length > MAX_ATTACHMENT_BYTES) {
        throw badRequest('An attachment must be between 1 byte and 10 MiB');
    }
    await requireMember(db, groupId, userId);
    await advisoryLock(db, `attachment-uploads:${userId}`);
    const existing = (
        await db.query('SELECT group_id, uploader_id FROM expense_attachments WHERE id = $1 FOR UPDATE', [id])
    ).rows[0];
    if (existing) {
        if (existing.group_id !== groupId || existing.uploader_id !== userId) {
            throw conflict('Attachment already exists');
        }
        await db.query(
            'UPDATE expense_attachments SET created_at = CURRENT_TIMESTAMP WHERE id = $1 AND expense_id IS NULL',
            [id],
        );
        return;
    }
    await db.query(`
        DELETE FROM expense_attachments WHERE id IN (
            SELECT id FROM expense_attachments
            WHERE expense_id IS NULL AND created_at < CURRENT_TIMESTAMP - INTERVAL '7 days'
            ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED
        )`);
    const pending = (
        await db.query(
            'SELECT COUNT(*) AS total FROM expense_attachments WHERE uploader_id = $1 AND expense_id IS NULL',
            [userId],
        )
    ).rows[0].total;
    if (pending >= 50) throw tooManyRequests('Too many unfinished attachment uploads');
    await db.query(
        `INSERT INTO expense_attachments (id, group_id, uploader_id, name, content_type, data)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, groupId, userId, name, contentType.toLowerCase(), data],
    );
}

export async function listAttachments(db: Db, expenseIds: string[]) {
    const result = new Map<string, AttachmentView[]>();
    if (expenseIds.length === 0) return result;
    const { rows } = await db.query(
        `SELECT expense_id, id, name, content_type FROM expense_attachments
         WHERE expense_id = ANY($1::uuid[]) ORDER BY position`,
        [expenseIds],
    );
    for (const row of rows) {
        const items = result.get(row.expense_id) ?? [];
        items.push({ id: row.id, name: row.name, contentType: row.content_type });
        result.set(row.expense_id, items);
    }
    return result;
}

export async function replaceAttachments(
    db: Db,
    expenseId: string,
    groupId: string,
    userId: string,
    ids: string[],
): Promise<void> {
    for (const [position, id] of ids.entries()) {
        const updated = await db.query(
            `UPDATE expense_attachments SET expense_id = $1, position = $2
             WHERE id = $3 AND group_id = $4 AND uploader_id = $5
               AND (expense_id IS NULL OR expense_id = $1)`,
            [expenseId, position, id, groupId, userId],
        );
        if (updated.rowCount !== 1) throw badRequest('An attachment is unavailable for this expense');
    }
    await db.query(
        'DELETE FROM expense_attachments WHERE expense_id = $1 AND NOT (id = ANY($2::uuid[]))',
        [expenseId, ids],
    );
}

export async function readAttachment(db: Db, userId: string, id: string): Promise<Buffer> {
    const { rows } = await db.query(
        `SELECT a.data FROM expense_attachments a
         JOIN expenses e ON e.id = a.expense_id AND e.deleted_at IS NULL
         JOIN group_members m ON m.group_id = e.group_id AND m.user_id = $2
         WHERE a.id = $1`,
        [id, userId],
    );
    if (!rows[0]) throw notFound('Attachment not found');
    return rows[0].data;
}
