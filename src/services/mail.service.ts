import { randomUUID } from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config';
import { Db, db, tx } from '../database';
import { subscribe } from '../events/outbox';
import {
    ConnectionAddedEvent,
    connectionAddedMessage,
    InvitationCreatedEvent,
    SettlementRecordedEvent,
    Topics,
} from '../events/types';
import { logger } from '../utils/logger';
import { brandLogoPath } from '../utils/brand';

// ---------------------------------------------------------------- transport

export function mailEnabled(): boolean {
    const { host, user, password } = config.mail;
    return Boolean(host && user && password);
}

let transporter: Transporter | undefined;
const BRAND_LOGO_CID = 'splitease-logo@lambrk.com';

function transport(): Transporter {
    transporter ??= nodemailer.createTransport({
        host: config.mail.host,
        port: config.mail.port,
        secure: config.mail.secure,
        auth: { user: config.mail.user, pass: config.mail.password },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
    });
    return transporter;
}

export interface Mail {
    to: string;
    subject: string;
    html: string;
    text: string;
}

function sender(): string {
    return `"${config.mail.fromName.replace(/["\\\r\n]/g, '')}" <${config.mail.fromAddress || config.mail.user}>`;
}

/** One delivery attempt over SMTP. Throws when the server does not accept the message. */
async function deliver(mail: Mail): Promise<void> {
    await transport().sendMail({
        from: sender(),
        to: mail.to,
        subject: mail.subject,
        html: mail.html,
        text: `${mail.text.trimEnd()}\n\n--\n${POWERED_BY_TEXT}\n`,
        attachments: mail.html.includes(`src="cid:${BRAND_LOGO_CID}"`)
            ? [{ filename: 'splitease-logo.png', path: brandLogoPath, cid: BRAND_LOGO_CID }]
            : undefined,
    });
}

// -------------------------------------------------------------------- queue

/**
 * Adds an email to the queue. Pass the caller's transaction connection to make the email
 * part of that transaction: it is only sent if the surrounding work commits.
 * Without SMTP settings the message is written to the log instead (the text body carries
 * the verification code), so local development works.
 */
export async function queueMail(conn: Db, mail: Mail, kind: string): Promise<void> {
    if (!mailEnabled()) {
        logger.info(`Email not sent (SMTP is not configured) to ${mail.to}: ${mail.subject}\n${mail.text}`);
        return;
    }
    await conn.query(
        `INSERT INTO email_queue
             (id, kind, to_address, subject, html, text_body, next_attempt_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
        [randomUUID(), kind, mail.to, mail.subject.slice(0, 300), mail.html, mail.text, new Date()],
    );
}

/**
 * Queues an email outside any transaction and starts delivery right away. It never
 * throws: a queue problem must not undo a registration that already succeeded.
 */
export async function queueMailSafely(mail: Mail, kind: string): Promise<void> {
    try {
        await queueMail(db, mail, kind);
        nudgeMailDispatcher();
    } catch (error) {
        logger.error(`Could not queue email "${mail.subject}"`, error);
    }
}

/** Seconds to wait after the nth failed attempt: 30s, 1m, 2m, 4m ... capped at 1 hour. */
function retryDelaySeconds(attempts: number): number {
    return Math.min(3600, 30 * 2 ** (attempts - 1));
}

/** True when trying again cannot help, e.g. the recipient address does not exist. */
function isPermanentFailure(error: unknown): boolean {
    const { code, responseCode } = (error ?? {}) as { code?: unknown; responseCode?: unknown };
    if (code === 'EENVELOPE') return true;
    // 5xx replies are final, except a rejected login, which is fixed by changing .env.
    return typeof responseCode === 'number' && responseCode >= 500 && code !== 'EAUTH';
}

function describeFailure(error: unknown): string {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'EAUTH') {
        return 'The SMTP server rejected the login. Check SMTP_USER and SMTP_PASSWORD in .env.';
    }
    return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

let lastCleanup = 0;

/** Sends every queued email that is due; failures are rescheduled or, after the last try, dropped. */
async function dispatchPendingMail(): Promise<void> {
    await tx(async (conn) => {
        const due = (
            await conn.query(
                `SELECT * FROM email_queue
                 WHERE sent_at IS NULL AND failed_at IS NULL AND next_attempt_at <= $1
                 ORDER BY next_attempt_at ASC LIMIT 20 FOR UPDATE SKIP LOCKED`,
                [new Date()],
            )
        ).rows;
        for (const row of due) {
            const now = new Date();
            try {
                await deliver({
                    to: row.to_address,
                    subject: row.subject,
                    html: row.html,
                    text: row.text_body,
                });
                await conn.query(
                    `UPDATE email_queue
                     SET sent_at = $1, attempts = attempts + 1, last_error = NULL,
                         html = '', text_body = ''
                     WHERE id = $2`,
                    [now, row.id],
                );
                if (row.attempts > 0) {
                    logger.info(`Email "${row.subject}" was sent after ${row.attempts + 1} attempts`);
                }
            } catch (error) {
                const attempts = row.attempts + 1;
                const reason = describeFailure(error);
                if (isPermanentFailure(error) || attempts >= config.mail.maxAttempts) {
                    await conn.query(
                        `UPDATE email_queue
                         SET failed_at = $1, attempts = $2, last_error = $3, html = '', text_body = ''
                         WHERE id = $4`,
                        [now, attempts, reason, row.id],
                    );
                    logger.error(`Gave up sending email "${row.subject}" after ${attempts} attempt(s): ${reason}`);
                } else {
                    const delay = retryDelaySeconds(attempts);
                    await conn.query(
                        `UPDATE email_queue
                         SET attempts = $1, last_error = $2, next_attempt_at = $3 WHERE id = $4`,
                        [attempts, reason, new Date(now.getTime() + delay * 1000), row.id],
                    );
                    logger.warn(
                        `Could not send email "${row.subject}" (attempt ${attempts} of ` +
                            `${config.mail.maxAttempts}): ${reason} Retrying in ${delay}s.`,
                    );
                }
            }
        }
        // Keep the table small: finished rows are only useful for a short while.
        if (Date.now() - lastCleanup > 3_600_000) {
            lastCleanup = Date.now();
            await conn.query(
                `DELETE FROM email_queue
                 WHERE created_at < $1 AND (sent_at IS NOT NULL OR failed_at IS NOT NULL)`,
                [new Date(Date.now() - 30 * 86_400_000)],
            );
        }
    });
}

let mailTimer: NodeJS.Timeout | undefined;
let mailRunning = false;
let mailStopped = true;

async function drainMailQueue(): Promise<void> {
    if (mailRunning) return;
    mailRunning = true;
    try {
        await dispatchPendingMail();
    } catch (error) {
        logger.error('Email dispatch failed', error);
    } finally {
        mailRunning = false;
    }
}

/** Delivers newly queued mail without waiting for the next scheduled check. */
function nudgeMailDispatcher(): void {
    if (!mailStopped) setImmediate(() => void drainMailQueue());
}

/** Starts the background sender. Does nothing without SMTP settings. */
export function startMailDispatcher(): void {
    if (!mailEnabled()) return;
    mailStopped = false;
    const tick = () => {
        void drainMailQueue().finally(() => {
            if (!mailStopped) mailTimer = setTimeout(tick, config.mail.dispatchDelayMs);
        });
    };
    mailTimer = setTimeout(tick, 1000);
}

export function stopMailDispatcher(): void {
    mailStopped = true;
    if (mailTimer) clearTimeout(mailTimer);
}

/** Logs at startup whether the SMTP login works, so a bad setting is seen before the first email. */
export async function verifyMailConnection(): Promise<void> {
    if (!mailEnabled()) return;
    try {
        await transport().verify();
        logger.info(`SMTP login OK (${config.mail.host}:${config.mail.port} as ${config.mail.user})`);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.error(
            `SMTP check failed for ${config.mail.user} at ${config.mail.host}:${config.mail.port}: ${reason}`,
        );
    }
}

// ---------------------------------------------------------------- templates

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Link target in the web app; the first APP_URL entry. */
function appLink(path = '', query: Record<string, string> = {}): string {
    const url = new URL(config.appUrls[0] + path);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return url.toString();
}

interface Layout {
    heading: string;
    /** Short summary shown next to the subject in inbox lists; hidden in the email itself. */
    preheader?: string;
    /** Trusted HTML; escape every user-supplied value with escapeHtml before using it here. */
    bodyHtml: string;
    button?: { label: string; url: string };
    footer?: string;
}

/** Credit line added to the bottom of every email (HTML and plain text). */
const POWERED_BY_TEXT = 'Splitease is powered by Lambrk';
const POWERED_BY_HTML =
    'Splitease is powered by <a href="https://lambrk.com" style="color:#176b50;text-decoration:none;font-weight:600">Lambrk</a>';

const GREEN = '#176b50';
const INK = '#1c2822';
const MUTED = '#5d6b64';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * Shared email shell. It uses nested tables and inline styles because many mail clients
 * ignore modern CSS.
 */
function layout({ heading, preheader, bodyHtml, button, footer }: Layout): string {
    const brand = escapeHtml(config.mail.fromName);
    const buttonHtml = button
        ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px">
             <tr><td align="center" bgcolor="${GREEN}" style="border-radius:8px">
               <a href="${escapeHtml(button.url)}" style="display:inline-block;padding:14px 32px;font:600 16px ${FONT};color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(button.label)}</a>
             </td></tr>
           </table>
           <p style="margin:16px 0 0;font:13px/1.5 ${FONT};color:${MUTED}">Button not working? Copy and paste this link into your browser:<br>
             <a href="${escapeHtml(button.url)}" style="color:${GREEN};word-break:break-all">${escapeHtml(button.url)}</a></p>`
        : '';
    const hidden = preheader
        ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#f3f5f1">${escapeHtml(preheader)}</div>`
        : '';
    const footerText =
        footer ??
        "You received this email because of activity on your SplitEase account. If this wasn't you, you can safely ignore it.";
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:#f3f5f1">
${hidden}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f3f5f1">
  <tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
      <tr><td bgcolor="${GREEN}" style="padding:24px 32px;border-radius:12px 12px 0 0">
        <img src="cid:${BRAND_LOGO_CID}" width="42" height="42" alt="" style="vertical-align:middle;margin-right:8px">
        <span style="font:700 22px ${FONT};color:#ffffff;letter-spacing:0.3px">${brand}</span>
      </td></tr>
      <tr><td bgcolor="#ffffff" style="padding:36px 32px 32px;border-radius:0 0 12px 12px;font:16px/1.6 ${FONT};color:${INK}">
        <h1 style="margin:0 0 20px;font:700 24px/1.3 ${FONT};color:${INK}">${escapeHtml(heading)}</h1>
        ${bodyHtml}
        ${buttonHtml}
      </td></tr>
      <tr><td style="padding:24px 16px 0;font:12px/1.6 ${FONT};color:#7b8a83;text-align:center">
        ${escapeHtml(footerText)}<br><br>
        ${POWERED_BY_HTML}
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function hoursText(ms: number): string {
    const hours = Math.max(1, Math.round(ms / 3_600_000));
    return hours === 1 ? '1 hour' : `${hours} hours`;
}

export function verificationEmail(
    to: string,
    displayName: string,
    token: string,
    lifetimeMs: number,
): Mail {
    const url = appLink('/verify-email', { token });
    const valid = hoursText(lifetimeMs);
    return {
        to,
        subject: 'Verify your email for SplitEase',
        text:
            `Hi ${displayName},\n\nConfirm your email address to finish creating your SplitEase account:\n${url}\n\n` +
            `Verification code: ${token}\n\nThis link and code are valid for ${valid}.\n`,
        html: layout({
            heading: 'Confirm your email',
            bodyHtml:
                `<p>Hi ${escapeHtml(displayName)},</p>` +
                '<p>Confirm your email address to finish creating your SplitEase account.</p>' +
                '<p style="font-size:13px;color:#5d6b64">Verification code (if you were asked for one):<br>' +
                `<code style="font-size:13px;word-break:break-all">${escapeHtml(token)}</code></p>` +
                `<p style="font-size:13px;color:#5d6b64">This link and code are valid for ${valid}.</p>`,
            button: { label: 'Verify email', url },
        }),
    };
}

export async function queueIosUpdateConfirmation(conn: Db, to: string, token: string) {
    const url = `${appLink('/ios-updates')}#${token}`;
    const subject = 'Confirm your SplitEase iOS launch signup';
    await queueMail(
        conn,
        {
            to,
            subject,
            text: `Confirm your email to hear when SplitEase launches for iPhone and iPad.\n\n${url}\n\nThis link expires in 24 hours.`,
            html: layout({
                heading: subject,
                bodyHtml: '<p>Confirm your email to hear when SplitEase launches for iPhone and iPad.</p><p>This link expires in 24 hours.</p>',
                button: { label: 'Confirm email', url },
            }),
        },
        'ios-update-confirmation',
    );
}

export function welcomeEmail(to: string, displayName: string): Mail {
    const url = appLink('/open');
    return {
        to,
        subject: 'Welcome to SplitEase',
        text:
            `Hi ${displayName},\n\nWelcome to SplitEase! Create a group, add your friends and start ` +
            `splitting expenses.\n${url}\n`,
        html: layout({
            heading: 'Welcome to SplitEase',
            bodyHtml:
                `<p>Hi ${escapeHtml(displayName)},</p>` +
                '<p>Your account is ready. Create a group, add your friends and start splitting expenses.</p>',
            button: { label: 'Open SplitEase', url },
        }),
    };
}

export interface ComposedMail {
    to: string;
    name: string;
    subject: string;
    heading: string;
    /** Plain text: blank lines separate paragraphs, lines starting with "- " are bullets. */
    body: string;
    buttonLabel?: string | null;
    buttonUrl?: string | null;
    footer?: string | null;
    preheader?: string | null;
}

/** Fills {{name}} / {{email}} in admin-written text. */
function fillVariables(text: string, name: string, email: string): string {
    return text.replace(/\{\{\s*name\s*\}\}/gi, name).replace(/\{\{\s*email\s*\}\}/gi, email);
}

function bodyToHtml(body: string): string {
    const bullet = /^\s*[-•]\s+/;
    const out: string[] = [];
    for (const block of body.trim().split(/\n{2,}/)) {
        // A block can mix a lead-in line with a list, so group consecutive lines by kind.
        let text: string[] = [];
        let items: string[] = [];
        const flushText = () => {
            if (text.length) out.push(`<p style="margin:0 0 16px">${text.map(escapeHtml).join('<br>')}</p>`);
            text = [];
        };
        const flushItems = () => {
            if (items.length) {
                out.push(
                    `<ul style="margin:0 0 16px;padding-left:22px">${items
                        .map((item) => `<li style="margin:0 0 6px">${escapeHtml(item)}</li>`)
                        .join('')}</ul>`,
                );
            }
            items = [];
        };
        for (const line of block.split('\n').map((l) => l.trimEnd())) {
            if (bullet.test(line)) {
                flushText();
                items.push(line.replace(bullet, ''));
            } else {
                flushItems();
                text.push(line);
            }
        }
        flushText();
        flushItems();
    }
    return out.join('');
}

/** An email written by an admin, wrapped in the standard SplitEase shell. */
export function composedEmail(input: ComposedMail): Mail {
    const fill = (value: string) => fillVariables(value, input.name, input.to);
    const body = fill(input.body);
    const heading = fill(input.heading);
    const url = input.buttonUrl && input.buttonLabel ? input.buttonUrl : null;
    return {
        to: input.to,
        subject: fill(input.subject).replace(/[\r\n]+/g, ' ').trim(),
        text: `${body.trim()}\n${url ? `\n${input.buttonLabel}: ${url}\n` : ''}`,
        html: layout({
            heading,
            preheader: input.preheader ? fill(input.preheader) : undefined,
            bodyHtml: bodyToHtml(body),
            button: url ? { label: input.buttonLabel as string, url } : undefined,
            footer: input.footer ? fill(input.footer) : undefined,
        }),
    };
}

export function friendInvitationEmail(to: string, inviter: string, url: string): Mail {
    const subject = `${inviter} invited you to connect on SplitEase`;
    const instructions = 'Open SplitEase and sign in with this email address to connect.';
    return {
        to,
        subject,
        text: `${subject}.\n\n${instructions}\n${url}\n\nThis link expires in seven days.`,
        html: layout({
            heading: subject,
            bodyHtml: `<p>${instructions}</p><p>This link expires in seven days.</p>`,
            button: { label: 'Open SplitEase', url },
        }),
    };
}

export function invitationEmail(
    to: string,
    groupName: string,
    inviterName: string | null,
    expiresAt: Date,
): Mail {
    // Android handles the verified link; the invitation page is the browser fallback.
    const url = appLink('/invite');
    const who = inviterName ?? 'A friend';
    const expires = `${expiresAt.toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
    })} (UTC)`;
    const detail = (label: string, value: string, last = false) =>
        `<tr>
           <td style="padding:12px 0;${last ? '' : 'border-bottom:1px solid #e3e8e2;'}font:600 13px ${FONT};color:${MUTED};width:120px;vertical-align:top">${label}</td>
           <td style="padding:12px 0;${last ? '' : 'border-bottom:1px solid #e3e8e2;'}font:16px ${FONT};color:${INK};vertical-align:top">${escapeHtml(value)}</td>
         </tr>`;
    const step = (number: number, text: string) =>
        `<tr>
           <td style="padding:6px 12px 6px 0;font:700 15px ${FONT};color:${GREEN};vertical-align:top;width:20px">${number}.</td>
           <td style="padding:6px 0;font:15px/1.5 ${FONT};color:${INK};vertical-align:top">${text}</td>
         </tr>`;
    return {
        to,
        subject: `${who} invited you to join ${groupName} on SplitEase`,
        text:
            `${who} invited you to join the group "${groupName}" on SplitEase.\n\n` +
            `SplitEase makes it easy to share expenses with friends and keep track of who owes what.\n\n` +
            `How to join:\n` +
            `1. Open SplitEase: ${url}\n` +
            `2. Sign in, or create an account, with this email address (${to}).\n` +
            `3. Open your notifications and accept the invitation.\n\n` +
            `This invitation expires on ${expires}.\n\n` +
            `If you do not know ${who} or were not expecting this, you can ignore this email.\n`,
        html: layout({
            heading: `Join ${groupName} on SplitEase`,
            preheader: `${who} invited you to share expenses in ${groupName}.`,
            bodyHtml:
                `<p style="margin:0 0 20px"><strong>${escapeHtml(who)}</strong> has invited you to join a group on SplitEase, ` +
                'the easy way to share expenses with friends and keep track of who owes what.</p>' +
                `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f6f8f5" style="border-radius:8px;margin:0 0 24px">
                   <tr><td style="padding:8px 20px">
                     <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                       ${detail('Group', groupName)}
                       ${detail('Invited by', who)}
                       ${detail('Expires', expires, true)}
                     </table>
                   </td></tr>
                 </table>` +
                `<p style="margin:0 0 8px;font:700 15px ${FONT};color:${INK}">How to join</p>
                 <table role="presentation" cellpadding="0" cellspacing="0">
                   ${step(1, 'Open SplitEase using the button below.')}
                   ${step(2, `Sign in, or create an account, with <strong>${escapeHtml(to)}</strong>.`)}
                   ${step(3, 'Open your notifications and accept the invitation.')}
                 </table>`,
            button: { label: 'Open SplitEase', url },
            footer: `If you do not know ${who} or were not expecting this invitation, you can safely ignore this email.`,
        }),
    };
}

export function paymentReceivedEmail(
    to: string,
    payerName: string,
    amount: string,
    currency: string,
    groupName: string | null,
): Mail {
    const url = appLink();
    const group = groupName ?? 'your group';
    return {
        to,
        subject: `${payerName} recorded a payment to you`,
        text:
            `${payerName} recorded a payment of ${currency} ${amount} to you in ${group}.\n` +
            `Your balance will update shortly.\n${url}\n`,
        html: layout({
            heading: 'Payment recorded',
            bodyHtml:
                `<p><strong>${escapeHtml(payerName)}</strong> recorded a payment of ` +
                `<strong>${escapeHtml(currency)} ${escapeHtml(amount)}</strong> to you in ` +
                `${escapeHtml(group)}.</p><p>Your balance will update shortly.</p>`,
            button: { label: 'View in SplitEase', url },
        }),
    };
}

// ------------------------------------------------------------ event emails

async function displayName(db: Db, userId: string): Promise<string | null> {
    const row = (await db.query('SELECT display_name FROM users WHERE id = $1', [userId])).rows[0];
    return row ? row.display_name : null;
}

/**
 * Emails for domain events. They are added to the email queue in the same transaction that
 * processes the event, so each one is queued exactly once; the queue worker sends it and
 * retries failures.
 */
export function registerMailConsumers(): void {
    subscribe(
        Topics.connectionAdded,
        'mail-connection-added',
        async (conn, event: ConnectionAddedEvent) => {
            const recipient = (
                await conn.query('SELECT email FROM users WHERE id = $1', [event.recipientId])
            ).rows[0];
            if (!recipient) return;
            const message = connectionAddedMessage(event);
            const url = appLink('/open');
            await queueMail(
                conn,
                {
                    to: recipient.email,
                    subject: message,
                    text: `${message}\n\nOpen SplitEase: ${url}`,
                    html: layout({
                        heading: message,
                        bodyHtml: '<p>Open SplitEase to see the update.</p>',
                        button: { label: 'Open SplitEase', url },
                    }),
                },
                event.groupId === null ? 'friend-added' : 'group-member-added',
            );
        },
    );

    subscribe(
        Topics.invitationCreated,
        'mail-invitation',
        async (conn, event: InvitationCreatedEvent) => {
            const inviter = await displayName(conn, event.invitedBy);
            await queueMail(
                conn,
                invitationEmail(
                    event.inviteeEmail,
                    event.groupName,
                    inviter,
                    new Date(event.expiresAt),
                ),
                'invitation',
            );
        },
    );

    subscribe(
        Topics.settlementRecorded,
        'mail-settlement',
        async (conn, event: SettlementRecordedEvent) => {
            const payee = (
                await conn.query('SELECT email FROM users WHERE id = $1', [event.payeeId])
            ).rows[0];
            if (!payee) return;
            const payer = (await displayName(conn, event.payerId)) ?? 'A group member';
            const group = (
                await conn.query('SELECT name FROM expense_groups WHERE id = $1', [event.groupId])
            ).rows[0];
            await queueMail(
                conn,
                paymentReceivedEmail(
                    payee.email,
                    payer,
                    event.amount,
                    event.currency,
                    group ? group.name : null,
                ),
                'payment',
            );
        },
    );
}
