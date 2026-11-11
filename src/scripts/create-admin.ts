import { randomBytes } from 'node:crypto';
import { pool } from '../database';
import { migrate } from '../database/migrate';
import { createAdmin } from '../services/admin.service';

/**
 *   npm run admin -- --email you@example.com --name "Your Name" [--password <text>]
 *
 * Creates a dashboard administrator. Without --password a random one is generated and printed
 * once. Re-run with --reset to change the password of an existing admin.
 */
async function main(): Promise<void> {
    const args = new Map<string, string>();
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        if (!argv[i].startsWith('--')) throw new Error(`Unexpected argument: ${argv[i]}`);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) args.set(argv[i].slice(2), '');
        else {
            args.set(argv[i].slice(2), next);
            i++;
        }
    }
    const email = (args.get('email') ?? '').trim().toLowerCase();
    const name = (args.get('name') ?? '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || name.length < 2) {
        console.log('Usage: npm run admin -- --email <email> --name <name> [--password <text>] [--reset]');
        process.exitCode = 1;
        return;
    }
    const generated = !args.get('password');
    const password = args.get('password') || randomBytes(12).toString('base64url');
    if (password.length < 10) throw new Error('--password must be at least 10 characters');

    await migrate();
    if (args.has('reset')) {
        const bcrypt = (await import('bcryptjs')).default;
        const result = await pool.query(
            'UPDATE admin_users SET password_hash = $2, disabled_at = NULL WHERE email = $1',
            [email, await bcrypt.hash(password, 12)],
        );
        if (!result.rowCount) throw new Error('No admin with that email');
        console.log(`Password reset for ${email}.`);
    } else {
        await createAdmin(email, name, password);
        console.log(`Admin created: ${email}`);
    }
    if (generated) console.log(`Password (shown once): ${password}`);
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
