import { db, tx } from '../database';
import { badRequest, notFound } from '../utils/errors';
import { Actor, audit } from './admin-actions.service';
import { composedEmail, mailEnabled, queueMail } from './mail.service';

export type Audience = 'user' | 'all' | 'verified' | 'premium' | 'ios-waitlist' | 'admins';

export interface MailDraft {
    subject: string;
    heading: string;
    body: string;
    buttonLabel: string | null;
    buttonUrl: string | null;
    footer: string | null;
}

export interface MailTemplate extends MailDraft {
    id: string;
    name: string;
    category: 'promotion' | 'warning' | 'notice' | 'update' | 'engagement' | 'general';
    description: string;
    /** Suggested audience in the composer. */
    audience: Audience;
}

const SIGN_OFF = 'Kind regards,\nThe SplitEase Team';

/**
 * Ready-made formal emails. Text in [[double brackets]] must be replaced before sending; the
 * server refuses to send a draft that still has one. {{name}} becomes the recipient's name.
 */
export const TEMPLATES: MailTemplate[] = [
    {
        id: 'promotion',
        name: 'Promotion / special offer',
        category: 'promotion',
        description: 'Announce a discount or limited-time offer.',
        audience: 'verified',
        subject: '[[Offer title]]: a special offer for SplitEase members',
        heading: '[[Offer title]]',
        body: `Dear {{name}},

Thank you for using SplitEase to keep shared expenses simple and fair. As a valued member, we would like to share a special offer with you.

[[Describe the offer in one or two sentences, for example: Get 30% off the No Ads Yearly plan.]]

Offer details:
- What you get: [[benefit]]
- Valid from [[start date]] until [[end date]]
- How to claim it: [[steps]]

Terms apply. The offer cannot be combined with other promotions and may be withdrawn at any time. If you have any questions, simply reply to this email and we will be glad to help.

${SIGN_OFF}`,
        buttonLabel: 'Open SplitEase',
        buttonUrl: null,
        footer:
            'You are receiving this email because you have a SplitEase account. This is a promotional message; you can reply to this email to ask us to stop sending them.',
    },
    {
        id: 'feature',
        name: 'New feature announcement',
        category: 'update',
        description: 'Tell members about something new in the app.',
        audience: 'all',
        subject: 'New in SplitEase: [[feature name]]',
        heading: 'What’s new in SplitEase',
        body: `Dear {{name}},

We are pleased to let you know about an improvement to SplitEase.

[[Feature name]] is now available. [[One or two sentences on what it does and why it helps.]]

Highlights:
- [[Highlight one]]
- [[Highlight two]]
- [[Highlight three]]

To use it, update to the latest version of the app. We would love to hear what you think: just reply to this email with your feedback.

${SIGN_OFF}`,
        buttonLabel: 'Open SplitEase',
        buttonUrl: null,
        footer: 'You are receiving this email because you have a SplitEase account.',
    },
    {
        id: 'warning',
        name: 'Account warning (policy)',
        category: 'warning',
        description: 'Formal warning about behaviour that breaks the rules. Send to one user.',
        audience: 'user',
        subject: 'Important: a warning regarding your SplitEase account',
        heading: 'Warning regarding your account',
        body: `Dear {{name}},

We are writing to inform you that activity on your SplitEase account ({{email}}) has been found to be in breach of our Terms of Use.

Reason for this warning:
- [[Describe what was reported or observed, with dates where possible]]

What we ask you to do:
- Stop the behaviour described above with immediate effect
- Review our Terms of Use, available in the app and on our website

Please note that this is a formal warning. If the behaviour continues, we may restrict or suspend your account without further notice. If you believe this warning was sent in error, please reply to this email within 7 days with any information you would like us to consider, and we will review it promptly.

${SIGN_OFF}`,
        buttonLabel: null,
        buttonUrl: null,
        footer: 'This message relates to your SplitEase account. Please do not share it with others.',
    },
    {
        id: 'suspension',
        name: 'Account suspension notice',
        category: 'warning',
        description: 'Tell a user their account has been suspended and how to appeal.',
        audience: 'user',
        subject: 'Your SplitEase account has been suspended',
        heading: 'Your account has been suspended',
        body: `Dear {{name}},

We are writing to confirm that your SplitEase account ({{email}}) has been suspended with effect from [[date]].

Reason:
- [[Short, factual reason]]

While your account is suspended you will not be able to sign in. Your groups and expense history are kept and remain visible to the other members of your groups.

If you believe this decision is a mistake, you may appeal by replying to this email and explaining your circumstances. We will review your appeal and respond within [[number]] working days.

${SIGN_OFF}`,
        buttonLabel: null,
        buttonUrl: null,
        footer: 'This message relates to your SplitEase account. Please do not share it with others.',
    },
    {
        id: 'security',
        name: 'Security alert',
        category: 'notice',
        description: 'Urgent notice about unusual activity or a security incident.',
        audience: 'user',
        subject: 'Security alert for your SplitEase account',
        heading: 'Security alert',
        body: `Dear {{name}},

We noticed [[describe the unusual activity, for example: sign-ins from an unfamiliar device on date]] on your SplitEase account ({{email}}).

If this was you, no action is needed.

If this was not you, we recommend that you:
- Sign out of all devices from the app
- Change the password of the email account linked to SplitEase
- Reply to this email so that we can help secure your account

For your safety, we will never ask you for your password or any verification code by email.

${SIGN_OFF}`,
        buttonLabel: null,
        buttonUrl: null,
        footer: 'This is a security message about your SplitEase account.',
    },
    {
        id: 'policy',
        name: 'Terms & Privacy update',
        category: 'update',
        description: 'Formal notice of a change to the Terms of Use or Privacy Policy.',
        audience: 'all',
        subject: 'Updates to the SplitEase Terms of Use and Privacy Policy',
        heading: 'We are updating our terms',
        body: `Dear {{name}},

We are updating the SplitEase [[Terms of Use / Privacy Policy]]. The changes take effect on [[effective date]].

Summary of the main changes:
- [[Change one]]
- [[Change two]]

You do not need to do anything. By continuing to use SplitEase after the effective date, you agree to the updated terms. If you do not agree, you may stop using the app and ask us to delete your account before that date.

The full text is available in the app and on our website. If you have questions, please reply to this email.

${SIGN_OFF}`,
        buttonLabel: 'Read the update',
        buttonUrl: null,
        footer: 'You are receiving this service notice because you have a SplitEase account.',
    },
    {
        id: 'maintenance',
        name: 'Scheduled maintenance',
        category: 'notice',
        description: 'Warn users about planned downtime.',
        audience: 'all',
        subject: 'Scheduled maintenance: SplitEase on [[date]]',
        heading: 'Scheduled maintenance',
        body: `Dear {{name}},

We will be carrying out scheduled maintenance on SplitEase to improve reliability and performance.

When: [[date]], from [[start time]] to [[end time]] ([[time zone]])

What to expect:
- The app may be unavailable or slow during this window
- Your data is safe and nothing will be lost
- Expenses you add while offline will sync once the service is back

We apologise for any inconvenience and thank you for your patience.

${SIGN_OFF}`,
        buttonLabel: null,
        buttonUrl: null,
        footer: 'You are receiving this service notice because you have a SplitEase account.',
    },
    {
        id: 'subscription-expiry',
        name: 'Subscription reminder',
        category: 'notice',
        description: 'Remind premium members that their plan is ending.',
        audience: 'premium',
        subject: 'Your SplitEase plan is ending soon',
        heading: 'Your plan ends soon',
        body: `Dear {{name}},

This is a courtesy reminder that your SplitEase plan is due to end on [[end date]].

After that date, ads will return and any premium benefits will stop. Your groups and expenses are not affected.

To keep your benefits without interruption, you can renew your plan in the app at any time before the end date.

Thank you for supporting SplitEase.

${SIGN_OFF}`,
        buttonLabel: 'Open SplitEase',
        buttonUrl: null,
        footer: 'You are receiving this email because you have a SplitEase subscription.',
    },
    {
        id: 'feedback',
        name: 'Feedback request',
        category: 'engagement',
        description: 'Ask members for feedback or a short survey.',
        audience: 'all',
        subject: 'We’d value your feedback on SplitEase',
        heading: 'How are we doing?',
        body: `Dear {{name}},

We are always working to make SplitEase better, and your opinion matters to us.

Could you spare [[number]] minutes to tell us:
- What you like most about SplitEase
- What is frustrating or missing
- What we should build next

[[Link to the survey, or ask people to reply to this email.]]

Every response is read by our team. Thank you for helping us improve.

${SIGN_OFF}`,
        buttonLabel: null,
        buttonUrl: null,
        footer: 'You are receiving this email because you have a SplitEase account.',
    },
    {
        id: 'reengage',
        name: 'We miss you',
        category: 'engagement',
        description: 'Gentle nudge to inactive members.',
        audience: 'verified',
        subject: 'Your friends are waiting on SplitEase',
        heading: 'It’s been a while',
        body: `Dear {{name}},

We noticed you have not been on SplitEase for a while. Shared costs have a way of piling up, and keeping a clear record makes settling up easier for everyone.

Here is how to pick up where you left off:
- Open your groups and check who owes what
- Add any expenses you have not yet recorded
- Settle up with the fewest possible payments

We hope to see you back soon.

${SIGN_OFF}`,
        buttonLabel: 'Open SplitEase',
        buttonUrl: null,
        footer: 'You are receiving this email because you have a SplitEase account.',
    },
    {
        id: 'ios-launch',
        name: 'iOS launch announcement',
        category: 'update',
        description: 'Tell the iOS waitlist that the app is available.',
        audience: 'ios-waitlist',
        subject: 'SplitEase is now available for iPhone',
        heading: 'SplitEase for iPhone is here',
        body: `Hello,

Thank you for asking to hear about SplitEase on iPhone. We are delighted to let you know that the app is now available.

[[Add the App Store link or launch details.]]

With SplitEase you can add shared expenses, see who owes what and settle up with the fewest payments. Your account works across Android and iPhone.

Thank you for your patience and support.

${SIGN_OFF}`,
        buttonLabel: 'Get SplitEase',
        buttonUrl: null,
        footer: 'You are receiving this email because you asked to be notified when SplitEase launched for iOS.',
    },
    {
        id: 'custom',
        name: 'Blank (write your own)',
        category: 'general',
        description: 'Start from an empty message.',
        audience: 'all',
        subject: '',
        heading: '',
        body: `Dear {{name}},

[[Write your message here.]]

${SIGN_OFF}`,
        buttonLabel: null,
        buttonUrl: null,
        footer: null,
    },
];

// --------------------------------------------------------------- recipients

interface Recipient {
    email: string;
    name: string;
}

const RECIPIENT_SQL: Record<Exclude<Audience, 'user'>, string> = {
    all: `SELECT email, display_name AS name FROM users WHERE disabled_at IS NULL ORDER BY created_at`,
    verified: `SELECT email, display_name AS name FROM users
               WHERE disabled_at IS NULL AND email_verified_at IS NOT NULL ORDER BY created_at`,
    premium: `SELECT u.email, u.display_name AS name FROM users u
              WHERE u.disabled_at IS NULL AND EXISTS (
                  SELECT 1 FROM subscriptions s WHERE s.user_id = u.id
                  AND s.status = 'ACTIVE' AND s.expires_at > now())
              ORDER BY u.created_at`,
    'ios-waitlist': `SELECT email, 'there' AS name FROM ios_update_subscriptions
                     WHERE confirmed_at IS NOT NULL ORDER BY requested_at`,
    admins: `SELECT email, display_name AS name FROM admin_users WHERE disabled_at IS NULL ORDER BY created_at`,
};

const MAX_RECIPIENTS = 5000;

async function recipients(audience: Audience, userId?: string): Promise<Recipient[]> {
    if (audience === 'user') {
        if (!userId) throw badRequest('Choose a user');
        const row = (await db.query('SELECT email, display_name FROM users WHERE id = $1', [userId])).rows[0];
        if (!row) throw notFound('User not found');
        return [{ email: row.email, name: row.display_name }];
    }
    const rows = (await db.query(RECIPIENT_SQL[audience])).rows;
    return rows.map((r) => ({ email: r.email, name: r.name }));
}

export async function audienceSizes() {
    const sizes: Record<string, number> = {};
    for (const key of Object.keys(RECIPIENT_SQL) as Exclude<Audience, 'user'>[]) {
        const count = (await db.query(`SELECT COUNT(*) AS n FROM (${RECIPIENT_SQL[key]}) t`)).rows[0].n;
        sizes[key] = Number(count);
    }
    return { sizes, smtpConfigured: mailEnabled() };
}

// ----------------------------------------------------------------- composing

const PLACEHOLDER = /\[\[[^\]]*\]\]/;

function validateDraft(draft: MailDraft): void {
    if (!draft.subject.trim() || !draft.heading.trim() || !draft.body.trim()) {
        throw badRequest('Subject, heading and message are required');
    }
    const text = [draft.subject, draft.heading, draft.body, draft.footer ?? '', draft.buttonLabel ?? ''].join('\n');
    if (PLACEHOLDER.test(text)) {
        throw badRequest('Replace every [[placeholder]] before sending');
    }
}

function toMail(draft: MailDraft, to: Recipient) {
    return composedEmail({
        to: to.email,
        name: to.name,
        subject: draft.subject,
        heading: draft.heading,
        body: draft.body,
        buttonLabel: draft.buttonLabel,
        buttonUrl: draft.buttonUrl,
        footer: draft.footer,
        preheader: draft.heading,
    });
}

export function preview(draft: MailDraft): { subject: string; html: string; text: string } {
    const mail = toMail(draft, { email: 'alex@example.com', name: 'Alex' });
    return {
        subject: mail.subject,
        // The inline logo is attached to real emails; the preview loads it from the website.
        html: mail.html.replace(/cid:splitease-logo@lambrk\.com/g, '/splitease-logo.png'),
        text: mail.text,
    };
}

export async function sendTest(actor: Actor & { displayName?: string }, draft: MailDraft): Promise<void> {
    validateDraft(draft);
    await queueMail(db, toMail(draft, { email: actor.email, name: actor.displayName ?? 'there' }), 'admin-test');
    await audit(actor, 'email.test', null, null, { subject: draft.subject });
}

export async function send(
    actor: Actor,
    input: { audience: Audience; userId?: string; templateId?: string } & MailDraft,
): Promise<{ queued: number; smtpConfigured: boolean }> {
    validateDraft(input);
    const list = await recipients(input.audience, input.userId);
    if (list.length === 0) throw badRequest('Nobody is in that audience');
    if (list.length > MAX_RECIPIENTS) {
        throw badRequest(`That audience has ${list.length} people; the limit per send is ${MAX_RECIPIENTS}.`);
    }
    await tx(async (conn) => {
        for (const to of list) {
            await queueMail(conn, toMail(input, to), `admin-${input.templateId ?? 'custom'}`.slice(0, 40));
        }
        await audit(
            actor,
            'email.send',
            input.audience === 'user' ? 'user' : null,
            input.audience === 'user' ? (input.userId ?? null) : null,
            {
                subject: input.subject,
                audience: input.audience,
                template: input.templateId ?? 'custom',
                recipients: list.length,
            },
            conn,
        );
    });
    return { queued: list.length, smtpConfigured: mailEnabled() };
}
