export interface HistoryChange {
    field: string;
    label: string;
    kind: 'ADDED' | 'REMOVED' | 'CHANGED';
    from: string | null;
    to: string | null;
    /** For attachment changes: the file, so the app can open it from the history. */
    attachment?: { id: string; name: string; contentType: string };
}

interface SnapshotShare {
    userId: string;
    amount?: number;
    value?: number;
    paidAmount?: number;
    dueDate?: string | null;
}

type Snapshot = Record<string, any>;

const SPLIT_LABELS: Record<string, string> = {
    EQUAL: 'Equal',
    EXACT: 'Exact amounts',
    PERCENTAGE: 'Percentages',
    SHARES: 'Shares',
};

function parse(text: string | null | undefined): Snapshot | null {
    if (!text) return null;
    try {
        const value = JSON.parse(text);
        return value && typeof value === 'object' ? value : null;
    } catch {
        return null;
    }
}

const money = (currency: string, amount: unknown) => `${currency} ${Number(amount).toFixed(2)}`;
const text = (value: unknown) => (value === null || value === undefined || value === '' ? null : String(value));
const day = (value: unknown) => (value ? String(value).slice(0, 10) : null);

function shares(snapshot: Snapshot): Map<string, SnapshotShare> {
    return new Map(((snapshot.shares ?? []) as SnapshotShare[]).map((share) => [share.userId, share]));
}

/** The user ids a snapshot mentions, so their names can be looked up in one query. */
export function snapshotUserIds(snapshotText: string): string[] {
    const snapshot = parse(snapshotText);
    if (!snapshot) return [];
    return [snapshot.paidBy, ...((snapshot.shares ?? []) as SnapshotShare[]).map((s) => s.userId)].filter(Boolean);
}

/** What changed between two revisions of an expense, in words a person can read. */
export function describeChanges(
    previousText: string | null,
    currentText: string,
    name: (userId: string) => string,
): HistoryChange[] {
    const current = parse(currentText);
    const previous = parse(previousText);
    if (!current || !previous) return [];
    const changes: HistoryChange[] = [];
    const currency = String(current.currency ?? '');
    const change = (field: string, label: string, from: string | null, to: string | null) => {
        if (from === to) return;
        changes.push({
            field,
            label,
            kind: from === null ? 'ADDED' : to === null ? 'REMOVED' : 'CHANGED',
            from,
            to,
        });
    };

    change('description', 'Description', text(previous.description), text(current.description));
    change(
        'amount',
        'Amount',
        previous.amount == null ? null : money(String(previous.currency ?? currency), previous.amount),
        current.amount == null ? null : money(currency, current.amount),
    );
    if (previous.currency !== current.currency) {
        change('currency', 'Currency', text(previous.currency), text(current.currency));
    }
    change('expenseDate', 'Date', day(previous.expenseDate), day(current.expenseDate));
    change('category', 'Category', text(previous.category), text(current.category));
    change('notes', 'Note', text(previous.notes), text(current.notes));
    change(
        'splitType',
        'Split method',
        SPLIT_LABELS[previous.splitType] ?? text(previous.splitType),
        SPLIT_LABELS[current.splitType] ?? text(current.splitType),
    );
    change('paidBy', 'Paid by', previous.paidBy ? name(previous.paidBy) : null, current.paidBy ? name(current.paidBy) : null);
    change(
        'remindAfterDays',
        'Auto-remind',
        previous.remindAfterDays ? `After ${previous.remindAfterDays} days` : null,
        current.remindAfterDays ? `After ${current.remindAfterDays} days` : null,
    );
    change('payByDate', 'Pay-by date', day(previous.payByDate), day(current.payByDate));

    // People: who joined or left the split, how each share changed and who has paid.
    const before = shares(previous);
    const after = shares(current);
    for (const [id, share] of after) {
        const old = before.get(id);
        if (!old) {
            change(`share:${id}`, name(id), null, `Added · ${money(currency, share.amount)}`);
            continue;
        }
        if (Number(old.amount) !== Number(share.amount)) {
            change(`share:${id}`, `${name(id)}'s share`, money(currency, old.amount), money(currency, share.amount));
        }
        if ((old.dueDate ?? null) !== (share.dueDate ?? null)) {
            change(`due:${id}`, `${name}'s due date`, day(old.dueDate), day(share.dueDate));
        }
        const paidBefore = Number(old.paidAmount ?? 0);
        const paidAfter = Number(share.paidAmount ?? 0);
        if (paidAfter !== paidBefore && id !== current.paidBy) {
            const delta = paidAfter - paidBefore;
            const owed = Number(share.amount);
            change(
                `paid:${id}`,
                `${name(id)} paid`,
                null,
                `${delta > 0 ? '+' : ''}${money(currency, delta)}${paidAfter >= owed ? ' · fully settled' : ` · ${money(currency, owed - paidAfter)} left`}`,
            );
        }
    }
    for (const [id] of before) {
        if (!after.has(id)) change(`share:${id}`, name(id), 'Was in the split', null);
    }

    // Attachments: names added and removed.
    type File = { id: string; name: string; contentType: string };
    const files = (snapshot: Snapshot) =>
        new Map<string, File>(((snapshot.attachments ?? []) as File[]).map((a) => [a.id, a]));
    const oldFiles = files(previous);
    const newFiles = files(current);
    for (const [id, file] of newFiles) {
        if (oldFiles.has(id)) continue;
        change(`file:${id}`, 'Attachment added', null, file.name);
        changes[changes.length - 1].attachment = { id, name: file.name, contentType: file.contentType };
    }
    for (const [id, file] of oldFiles) {
        if (newFiles.has(id)) continue;
        change(`file:${id}`, 'Attachment removed', file.name, null);
        changes[changes.length - 1].attachment = { id, name: file.name, contentType: file.contentType };
    }
    return changes;
}

/** A one-line description of what happened at this revision. */
export function summarize(
    action: string,
    changes: HistoryChange[],
    current: Snapshot | null,
    name: (userId: string) => string,
    actor: string,
): string {
    if (action === 'CREATED') {
        const people = ((current?.shares ?? []) as SnapshotShare[]).length;
        return `${actor} added this expense${current ? ` · ${money(String(current.currency), current.amount)} split between ${people} ${people === 1 ? 'person' : 'people'}` : ''}`;
    }
    if (action === 'DELETED') return `${actor} deleted this expense`;
    if (action === 'PAYMENT_RECORDED') {
        const paid = changes.find((c) => c.field.startsWith('paid:'));
        return paid ? `${actor} recorded a payment · ${paid.label.replace(/ paid$/, '')}` : `${actor} recorded a payment`;
    }
    if (changes.length === 0) return `${actor} saved this expense without changes`;
    const labels = [...new Set(changes.map((c) => (c.field.startsWith('share:') ? 'split' : c.field.startsWith('file:') ? 'attachments' : c.label.toLowerCase())))];
    return `${actor} changed the ${labels.slice(0, 3).join(', ')}${labels.length > 3 ? ' and more' : ''}`;
}

export { parse as parseSnapshot };
