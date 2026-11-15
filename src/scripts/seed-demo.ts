/**
 * Replaces one account's data with dummy data for screenshots / demo videos.
 *   npx tsx src/scripts/seed-demo.ts [email]
 * Deletes every group the account belongs to (with expenses, settlements, balances),
 * its friendships and notifications, then seeds friends, groups, expenses and settlements.
 */
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';

const EMAIL = process.argv.find((a) => a.includes('@')) ?? 'debarunlahiri2016@gmail.com';
/** --keep: add a second dataset next to the existing data instead of wiping first. */
const KEEP = process.argv.includes('--keep');
const RENAME: Record<string, string> = {
    'Goa Trip 2026': 'Manali Trip 2026',
    'Flat 402 Roommates': 'PG Housemates',
    'Office Lunch Gang': 'College Friends',
    'Movie Night': 'Weekend Cricket',
};
const DESC: Record<string, string> = {
    'Beach Resort - 3 nights': 'Mountain Homestay - 3 nights',
    'Scuba Diving': 'Paragliding at Solang',
    "Dinner at Fisherman's Wharf": 'Dinner at Johnson\'s Cafe',
    'Beach Shack Lunch': 'Maggi Point Lunch',
    'Souvenirs & Cashews': 'Woollen Caps & Shawls',
    'Movie Tickets - Dune 3': 'Turf Booking',
    'Popcorn & Drinks': 'Energy Drinks & Snacks',
    'November Rent': 'November PG Rent',
    'Biryani Blues': 'Canteen Thali',
    'Dominos Pizza': 'Pizza Hut Lunch',
    'Birthday Cake for Priya': 'Birthday Cake for Kabir',
};
const rn = (n: string) => (KEEP ? RENAME[n] ?? n : n);
const rd = (n: string) => (KEEP ? DESC[n] ?? n : n);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const daysAgo = (n: number, hour = 12) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(hour, Math.floor(Math.random() * 59), 0, 0);
    return d;
};
const dateOnly = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const money = (cents: number) => (cents / 100).toFixed(2);

/** Equal split in paise so the shares always add up to the amount. */
function equalSplit(totalPaise: number, ids: string[]): number[] {
    const base = Math.floor(totalPaise / ids.length);
    const rest = totalPaise - base * ids.length;
    return ids.map((_, i) => base + (i < rest ? 1 : 0));
}

const FRIENDS = [
    { key: 'aarav', name: 'Aarav Sharma', upi: 'aarav.sharma@okhdfcbank' },
    { key: 'priya', name: 'Priya Mehta', upi: 'priya.mehta@oksbi' },
    { key: 'rohan', name: 'Rohan Verma', upi: 'rohanverma@ybl' },
    { key: 'ananya', name: 'Ananya Iyer', upi: 'ananya.iyer@okicici' },
    { key: 'kabir', name: 'Kabir Singh', upi: 'kabir.singh@paytm' },
    { key: 'neha', name: 'Neha Kapoor', upi: 'nehakapoor@axl' },
];

interface Exp {
    group: string;
    desc: string;
    amount: number; // rupees
    paidBy: string; // friend key or 'me'
    ago: number;
    category: string;
    among?: string[]; // defaults to all members
    notes?: string;
    paidShares?: string[]; // members who already paid their share back to the payer
}

const GROUPS: { name: string; members: string[]; ago: number }[] = [
    { name: 'Goa Trip 2026', members: ['aarav', 'priya', 'rohan', 'ananya', 'kabir'], ago: 40 },
    { name: 'Flat 402 Roommates', members: ['rohan', 'kabir', 'neha'], ago: 90 },
    { name: 'Office Lunch Gang', members: ['priya', 'ananya', 'neha'], ago: 30 },
    { name: 'Movie Night', members: ['aarav', 'neha'], ago: 12 },
];

const EXPENSES: Exp[] = [
    // Goa Trip
    { group: 'Goa Trip 2026', desc: 'Beach Resort - 3 nights', amount: 21600, paidBy: 'me', ago: 28, category: 'Travel', notes: 'Booked on MakeMyTrip', paidShares: ['aarav', 'priya'] },
    { group: 'Goa Trip 2026', desc: 'Scuba Diving', amount: 8400, paidBy: 'aarav', ago: 26, category: 'Entertainment' },
    { group: 'Goa Trip 2026', desc: 'Dinner at Fisherman\'s Wharf', amount: 5280, paidBy: 'priya', ago: 26, category: 'Food', paidShares: ['me'] },
    { group: 'Goa Trip 2026', desc: 'Airport Cab', amount: 2450, paidBy: 'rohan', ago: 28, category: 'Travel' },
    { group: 'Goa Trip 2026', desc: 'Scooter Rental', amount: 1800, paidBy: 'me', ago: 25, category: 'Travel', among: ['me', 'kabir', 'ananya'] },
    { group: 'Goa Trip 2026', desc: 'Beach Shack Lunch', amount: 3150, paidBy: 'kabir', ago: 25, category: 'Food' },
    { group: 'Goa Trip 2026', desc: 'Souvenirs & Cashews', amount: 1260, paidBy: 'ananya', ago: 24, category: 'Shopping' },
    // Flat 402
    { group: 'Flat 402 Roommates', desc: 'November Rent', amount: 48000, paidBy: 'me', ago: 14, category: 'Rent', paidShares: ['rohan', 'kabir'] },
    { group: 'Flat 402 Roommates', desc: 'Electricity Bill', amount: 3240, paidBy: 'rohan', ago: 10, category: 'Utilities' },
    { group: 'Flat 402 Roommates', desc: 'WiFi Recharge', amount: 1179, paidBy: 'me', ago: 9, category: 'Utilities' },
    { group: 'Flat 402 Roommates', desc: 'Maid Salary', amount: 2500, paidBy: 'neha', ago: 7, category: 'Maid' },
    { group: 'Flat 402 Roommates', desc: 'Blinkit Groceries', amount: 1860, paidBy: 'kabir', ago: 4, category: 'Groceries' },
    { group: 'Flat 402 Roommates', desc: 'Cooking Gas Cylinder', amount: 1100, paidBy: 'me', ago: 2, category: 'Utilities' },
    // Office Lunch
    { group: 'Office Lunch Gang', desc: 'Biryani Blues', amount: 1480, paidBy: 'priya', ago: 8, category: 'Food' },
    { group: 'Office Lunch Gang', desc: 'Dominos Pizza', amount: 1260, paidBy: 'me', ago: 5, category: 'Food', paidShares: ['ananya'] },
    { group: 'Office Lunch Gang', desc: 'Team Coffee Run', amount: 640, paidBy: 'neha', ago: 3, category: 'Food' },
    { group: 'Office Lunch Gang', desc: 'Birthday Cake for Priya', amount: 899, paidBy: 'ananya', ago: 1, category: 'Food' },
    // Movie Night
    { group: 'Movie Night', desc: 'Movie Tickets - Dune 3', amount: 1200, paidBy: 'aarav', ago: 6, category: 'Entertainment' },
    { group: 'Movie Night', desc: 'Popcorn & Drinks', amount: 720, paidBy: 'me', ago: 6, category: 'Food' },
];

const SETTLEMENTS = [
    { group: 'Goa Trip 2026', from: 'rohan', to: 'me', amount: 2500, ago: 15, note: 'Goa share - UPI' },
    { group: 'Flat 402 Roommates', from: 'neha', to: 'me', amount: 5000, ago: 6, note: 'Rent part' },
    { group: 'Office Lunch Gang', from: 'me', to: 'priya', amount: 370, ago: 2, note: 'Biryani' },
];

async function main() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const me = (await client.query('SELECT id FROM users WHERE lower(email) = lower($1)', [EMAIL])).rows[0]?.id;
        if (!me) throw new Error(`No user with email ${EMAIL}`);

        // ---- wipe -------------------------------------------------------
        const groupIds = (await client.query('SELECT group_id FROM group_members WHERE user_id = $1', [me])).rows.map((r) => r.group_id);
        if (groupIds.length && !KEEP) {
            for (const t of ['expense_audit', 'expense_projections', 'settlements', 'group_balances', 'recurring_expenses', 'expense_templates']) {
                await client.query(`DELETE FROM ${t} WHERE group_id = ANY($1)`, [groupIds]);
            }
            await client.query('DELETE FROM expense_payment_claims WHERE expense_id IN (SELECT id FROM expenses WHERE group_id = ANY($1))', [groupIds]);
            await client.query('DELETE FROM expenses WHERE group_id = ANY($1)', [groupIds]); // cascades shares, attachments, reminders
            await client.query('DELETE FROM group_invitations WHERE group_id = ANY($1)', [groupIds]);
            await client.query('DELETE FROM expense_groups WHERE id = ANY($1)', [groupIds]); // cascades members, invite links
        }
        if (!KEEP) {
        await client.query('DELETE FROM notifications WHERE user_id = $1', [me]);
        await client.query('DELETE FROM friend_invites WHERE inviter_id = $1', [me]);
        await client.query('DELETE FROM friendships WHERE first_user_id = $1 OR second_user_id = $1', [me]);
        await client.query('DELETE FROM invoices WHERE group_id = ANY($1)', [groupIds]);
        }
        // Contacts nobody is grouped with any more.
        await client.query(
            `DELETE FROM users WHERE is_contact AND NOT EXISTS (SELECT 1 FROM group_members m WHERE m.user_id = users.id)`,
        );
        // Previous dummy friends from an earlier run of this script.
        await client.query(
            `DELETE FROM users WHERE email LIKE '%@demo.splitease.invalid' AND NOT EXISTS (SELECT 1 FROM group_members m WHERE m.user_id = users.id)`,
        );

        // ---- friends ----------------------------------------------------
        const id: Record<string, string> = { me };
        for (const f of FRIENDS) {
            id[f.key] = randomUUID();
            await client.query(
                `INSERT INTO users (id, email, display_name, password_hash, created_at, email_verified_at, upi_id, country)
                 VALUES ($1, $2, $3, '!', $4, $4, $5, 'IN')`,
                [id[f.key], `${f.key}.${id[f.key].slice(0, 8)}@demo.splitease.invalid`, f.name, daysAgo(120), f.upi],
            );
            const [a, b] = [me, id[f.key]].sort();
            await client.query('INSERT INTO friendships (first_user_id, second_user_id, created_at) VALUES ($1, $2, $3)', [a, b, daysAgo(100)]);
        }
        await client.query(`UPDATE users SET upi_id = COALESCE(upi_id, 'debarun@okaxis'), country = COALESCE(country, 'IN') WHERE id = $1`, [me]);

        // ---- groups -----------------------------------------------------
        const gid: Record<string, string> = {};
        const members: Record<string, string[]> = {};
        for (const g of GROUPS) {
            gid[g.name] = randomUUID();
            members[g.name] = ['me', ...g.members];
            await client.query(
                `INSERT INTO expense_groups (id, name, default_currency, created_by, created_at) VALUES ($1, $2, 'INR', $3, $4)`,
                [gid[g.name], rn(g.name), me, daysAgo(g.ago)],
            );
            for (const k of members[g.name]) {
                await client.query(
                    `INSERT INTO group_members (id, group_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4, $5)`,
                    [randomUUID(), gid[g.name], id[k], k === 'me' ? 'OWNER' : 'MEMBER', daysAgo(g.ago)],
                );
            }
        }

        // ---- expenses ---------------------------------------------------
        const balances = new Map<string, number>(); // `${group}|${user}` -> paise
        const bump = (group: string, user: string, paise: number) => {
            const k = `${group}|${user}`;
            balances.set(k, (balances.get(k) ?? 0) + paise);
        };
        for (const e of EXPENSES) {
            const g = gid[e.group];
            const among = e.among ?? members[e.group];
            const total = Math.round(e.amount * 100);
            const parts = equalSplit(total, among);
            const expId = randomUUID();
            const created = daysAgo(e.ago);
            await client.query(
                `INSERT INTO expenses (id, group_id, paid_by, description, amount, currency, expense_date, split_type, created_at, category, notes, revision)
                 VALUES ($1, $2, $3, $4, $5, 'INR', $6, 'EQUAL', $7, $8, $9, 0)`,
                [expId, g, id[e.paidBy], rd(e.desc), money(total), dateOnly(created), created, e.category, e.notes ?? null],
            );
            const shareViews = [];
            for (let i = 0; i < among.length; i++) {
                const k = among[i];
                const isPayer = k === e.paidBy;
                const settled = isPayer || (e.paidShares ?? []).includes(k);
                await client.query(
                    `INSERT INTO expense_shares (id, expense_id, user_id, amount, paid_amount, split_value) VALUES ($1, $2, $3, $4, $5, $6)`,
                    [randomUUID(), expId, id[k], money(parts[i]), settled ? money(parts[i]) : '0.00', money(parts[i])],
                );
                bump(e.group, id[k], -parts[i]);
                shareViews.push({
                    userId: id[k], value: parts[i] / 100, amount: parts[i] / 100,
                    paidAmount: settled ? parts[i] / 100 : 0, dueDate: null, payByDate: null,
                    status: settled ? 'PAID' : 'PENDING',
                });
            }
            bump(e.group, id[e.paidBy], total);
            const shares = among.map((k, i) => ({ userId: id[k], amount: money(parts[i]) }));
            await client.query(
                `INSERT INTO expense_projections (expense_id, group_id, revision, snapshot) VALUES ($1, $2, 0, $3)`,
                [expId, g, JSON.stringify({ paidBy: id[e.paidBy], amount: money(total), currency: 'INR', shares })],
            );
            await client.query(
                `INSERT INTO expense_audit (id, expense_id, group_id, actor_id, action, revision, snapshot, occurred_at)
                 VALUES ($1, $2, $3, $4, 'CREATED', 0, $5, $6)`,
                [randomUUID(), expId, g, id[e.paidBy], JSON.stringify({
                    id: expId, groupId: g, paidBy: id[e.paidBy], description: rd(e.desc), amount: total / 100,
                    currency: 'INR', expenseDate: dateOnly(created), splitType: 'EQUAL', shares: shareViews,
                    createdAt: created.toISOString(), updatedAt: null, category: e.category, notes: e.notes ?? '',
                    remindAfterDays: null, payByDate: null, attachments: [], receipt: null, revision: 0,
                }), created],
            );
            // Notify me of expenses somebody else added.
            if (e.paidBy !== 'me' && among.includes('me')) {
                const who = FRIENDS.find((f) => f.key === e.paidBy)!.name;
                await client.query(
                    `INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at, group_id, expense_id)
                     VALUES ($1, $2, 'EXPENSE_CREATED', $3, $4, $5, $6, $7, $8)`,
                    [randomUUID(), me, 'New expense added',
                     `${who} added "${rd(e.desc)}" in ${rn(e.group)}. Your share: ₹${(parts[among.indexOf('me')] / 100).toFixed(2)}`,
                     e.ago > 7, created, g, expId],
                );
            }
        }

        // ---- settlements ------------------------------------------------
        for (const s of SETTLEMENTS) {
            const paise = Math.round(s.amount * 100);
            await client.query(
                `INSERT INTO settlements (id, group_id, payer_id, payee_id, amount, currency, note, created_at)
                 VALUES ($1, $2, $3, $4, $5, 'INR', $6, $7)`,
                [randomUUID(), gid[s.group], id[s.from], id[s.to], money(paise), s.note, daysAgo(s.ago)],
            );
            bump(s.group, id[s.from], paise);
            bump(s.group, id[s.to], -paise);
            const other = s.from === 'me' ? s.to : s.from;
            const who = FRIENDS.find((f) => f.key === other)!.name;
            await client.query(
                `INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at, group_id)
                 VALUES ($1, $2, 'SETTLEMENT_RECORDED', 'Payment recorded', $3, true, $4, $5)`,
                [randomUUID(), me, s.from === 'me' ? `You paid ${who} ₹${s.amount} in ${rn(s.group)}` : `${who} paid you ₹${s.amount} in ${rn(s.group)}`, daysAgo(s.ago), gid[s.group]],
            );
        }

        // ---- balances ---------------------------------------------------
        for (const [key, paise] of balances) {
            const [gName, uid] = key.split('|');
            await client.query(
                `INSERT INTO group_balances (id, group_id, user_id, currency, amount, updated_at) VALUES ($1, $2, $3, 'INR', $4, now())`,
                [randomUUID(), gid[gName], uid, money(paise)],
            );
        }

        // ---- a few more notifications ----------------------------------
        for (const [i, f] of FRIENDS.slice(0, 3).entries()) {
            await client.query(
                `INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at) VALUES ($1, $2, 'FRIEND_ADDED', 'New friend', $3, true, $4)`,
                [randomUUID(), me, `${f.name} is now your friend`, daysAgo(60 - i)],
            );
        }
        await client.query(
            `INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at, group_id)
             VALUES ($1, $2, 'EXPENSE_REMINDER', 'Payment reminder', $5, false, $3, $4)`,
            [randomUUID(), me, daysAgo(0, 9), gid['Goa Trip 2026'], `You still owe Aarav ₹1,400.00 for "${rd('Scuba Diving')}" in ${rn('Goa Trip 2026')}`],
        );

        await client.query('COMMIT');
        console.log(`Seeded ${GROUPS.length} groups, ${EXPENSES.length} expenses, ${SETTLEMENTS.length} settlements, ${FRIENDS.length} friends for ${EMAIL}`);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
