import { Db } from '../database';
import { config } from '../config';
import { PageRequest, PageResponse, pageResponse } from '../utils/http';

export interface InvoiceSummary {
    number: string;
    status: 'PAID' | 'PARTIAL';
    /** PAYEE: you were paid and issued it. PAYER: you paid and are billed. */
    role: 'PAYEE' | 'PAYER';
    paidAt: Date;
    payee: { id: string; name: string };
    payer: { id: string; name: string };
    groupName: string;
    currency: string;
    total: number;
    paid: number;
    items: { description: string; date: string; amount: string; paid: string }[];
    /** The invoice page on the website, while the pay link it came from is still active. */
    url: string | null;
}

/** Invoices the caller issued or was billed on, newest first. `q` matches the number, a name, the group or an item. */
export async function listInvoices(db: Db, userId: string, page: PageRequest, q: string | undefined): Promise<PageResponse<InvoiceSummary>> {
    const needle = q?.trim() ? `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const where = `(i.payee_id = $1 OR i.payer_id = $1)
        AND ($2::text IS NULL OR i.number ILIKE $2 OR pe.display_name ILIKE $2 OR pr.display_name ILIKE $2
             OR g.name ILIKE $2 OR i.items::text ILIKE $2)`;
    const from = `FROM invoices i
        JOIN users pe ON pe.id = i.payee_id
        JOIN users pr ON pr.id = i.payer_id
        JOIN expense_groups g ON g.id = i.group_id`;
    const total = (await db.query(`SELECT COUNT(*) AS n ${from} WHERE ${where}`, [userId, needle])).rows[0].n;
    const rows = (
        await db.query(
            `SELECT i.*, pe.display_name AS payee_name, pr.display_name AS payer_name, g.name AS group_name,
                    EXISTS (SELECT 1 FROM pay_links l WHERE l.code = i.link_code AND l.expires_at > now()) AS link_active
             ${from} WHERE ${where}
             ORDER BY i.paid_at DESC LIMIT $3 OFFSET $4`,
            [userId, needle, page.size, page.offset],
        )
    ).rows;
    return pageResponse(
        rows.map((r: any) => ({
            number: r.number,
            status: r.status,
            role: r.payee_id === userId ? ('PAYEE' as const) : ('PAYER' as const),
            paidAt: r.paid_at,
            payee: { id: r.payee_id, name: r.payee_name },
            payer: { id: r.payer_id, name: r.payer_name },
            groupName: r.group_name,
            currency: r.currency,
            total: Number(r.total),
            paid: Number(r.paid),
            items: r.items,
            url: r.link_active && r.link_code ? `${config.appUrls[0]}/p/${r.link_code}/invoice/${r.link_index}` : null,
        })),
        page,
        total,
    );
}
