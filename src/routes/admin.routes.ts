import { Router } from 'express';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as actions from '../services/admin-actions.service';
import * as admin from '../services/admin.service';
import * as campaign from '../services/campaign.service';
import { badRequest } from '../utils/errors';
import { asyncHandler, pageRequest, route, uuidParam } from '../utils/http';
import { email, notBlank, parseBody, uuid } from '../validators/common';

export const adminRouter = Router();

const queryText = (req: { query: Record<string, unknown> }, name: string): string | undefined => {
    const value = req.query[name];
    return typeof value === 'string' && value.length <= 200 ? value : undefined;
};

/** Admin routes accept only admin tokens, never app-user tokens. */
const requireAdmin: RequestHandler = asyncHandler(async (req, res, next) => {
    if (!admin.adminEnabled()) {
        res.status(503).end();
        return;
    }
    const header = req.header('authorization');
    const found = header?.startsWith('Bearer ') ? await admin.authenticateAdmin(header.slice(7)) : undefined;
    if (!found) {
        res.status(401).end();
        return;
    }
    req.admin = found;
    next();
});

const actor = (req: { admin?: { id: string; email: string } }) => {
    if (!req.admin) throw badRequest('Admin required');
    return req.admin;
};
const text = (max: number) => z.string().trim().min(1, 'must not be blank').max(max);

// ------------------------------------------------------------------- auth
adminRouter.post(
    '/auth/login',
    route(200, async (req) =>
        admin.login(
            parseBody(z.object({ email, password: notBlank(200) }), req.body),
            req.ip ?? 'unknown',
        ),
    ),
);

adminRouter.use(requireAdmin);

adminRouter.get('/auth/me', route(200, async (req) => req.admin));
adminRouter.get('/overview', route(200, () => admin.overview()));

// ------------------------------------------------------------------ users
adminRouter.get(
    '/users',
    route(200, async (req) =>
        admin.listUsers(pageRequest(req), queryText(req, 'q'), queryText(req, 'verified')),
    ),
);
adminRouter.get('/users/:id', route(200, async (req) => admin.userDetail(uuidParam(req, 'id'))));
adminRouter.post(
    '/users/:id/revoke-sessions',
    route(200, async (req) => admin.revokeUserSessions(uuidParam(req, 'id'))),
);
adminRouter.post(
    '/users/:id/verify-email',
    route(204, async (req) => admin.markUserVerified(uuidParam(req, 'id'))),
);

// --------------------------------------------------------------- expenses
adminRouter.get(
    '/groups/:id/expenses',
    route(200, async (req) =>
        admin.listGroupExpenses(uuidParam(req, 'id'), pageRequest(req), queryText(req, 'deleted') === 'yes'),
    ),
);
adminRouter.get('/expenses/:id', route(200, async (req) => admin.expenseDetail(uuidParam(req, 'id'))));

// Only these types are shown inline; everything else is offered as a download.
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);
adminRouter.get(
    '/attachments/:id',
    asyncHandler(async (req, res) => {
        const file = await admin.readAttachmentForAdmin(uuidParam(req, 'id'));
        const inline = INLINE_TYPES.has(file.contentType.toLowerCase());
        res.set({
            'Content-Type': inline ? file.contentType : 'application/octet-stream',
            'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
            // A CSP would stop browsers' built-in PDF viewers, so it is only set for other types.
            ...(file.contentType.toLowerCase() === 'application/pdf'
                ? {}
                : { 'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'" }),
        }).send(file.data);
    }),
);

// ----------------------------------------------------------------- groups
adminRouter.get(
    '/groups',
    route(200, async (req) => admin.listGroups(pageRequest(req), queryText(req, 'q'))),
);
adminRouter.get('/groups/:id', route(200, async (req) => admin.groupDetail(uuidParam(req, 'id'))));

// ---------------------------------------------------------- subscriptions
adminRouter.get(
    '/subscriptions',
    route(200, async (req) => admin.listSubscriptions(pageRequest(req), queryText(req, 'status'))),
);
adminRouter.get('/plans', route(200, () => admin.listPlans()));
const PlanFields = z.object({
    name: text(80),
    price: z.number().min(0).max(1_000_000),
    currency: z.string().regex(/^[A-Za-z]{3}$/, 'must be a 3-letter code').transform((v) => v.toUpperCase()),
    durationDays: z.number().int().min(1).max(3650),
    removesAds: z.boolean(),
    active: z.boolean(),
    googleProductId: z.string().trim().max(120).nullish().transform((v) => v || null),
    appleProductId: z.string().trim().max(120).nullish().transform((v) => v || null),
});

adminRouter.post(
    '/plans',
    route(201, async (req) => {
        const body = parseBody(
            PlanFields.extend({ code: z.string().trim().regex(/^[A-Z0-9_]{2,40}$/, 'use capitals, digits and _ (2-40 chars)') }),
            req.body,
        );
        return actions.createPlan(actor(req), body);
    }),
);
// A body with only { active } flips the on-sale switch; a full body edits the plan.
adminRouter.patch(
    '/plans/:id',
    route(204, async (req) => {
        const id = uuidParam(req, 'id');
        const keys = Object.keys(req.body ?? {});
        if (keys.length === 1 && keys[0] === 'active') {
            const body = parseBody(z.object({ active: z.boolean() }), req.body);
            await admin.setPlanActive(id, body.active);
            await actions.audit(actor(req), body.active ? 'plan.show' : 'plan.hide', 'plan', id);
            return;
        }
        await actions.updatePlan(actor(req), id, parseBody(PlanFields, req.body));
    }),
);
adminRouter.post(
    '/plans/:id/delete',
    route(204, async (req) => actions.deletePlan(actor(req), uuidParam(req, 'id'))),
);

// ------------------------------------------------------------ app versions
const PublishVersion = z.object({
    versionCode: z.number().int().positive(),
    versionName: notBlank(40),
    minSupportedVersionCode: z.number().int().min(0).default(0),
    apkUrl: z.string().max(2048).regex(/^https?:\/\//i, 'must be an http(s) address'),
    apkSha256: z
        .string()
        .regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters')
        .transform((v) => v.toLowerCase())
        .nullish()
        .transform((v) => v ?? null),
    releaseNotes: z.string().max(5000).default(''),
});

adminRouter.get('/app-versions', route(200, () => admin.listAppVersions()));
adminRouter.post(
    '/app-versions',
    route(201, async (req) => admin.publishAppVersion(parseBody(PublishVersion, req.body))),
);
adminRouter.patch(
    '/app-versions/:id',
    route(204, async (req) => {
        const body = parseBody(z.object({ published: z.boolean() }), req.body);
        await admin.setAppVersionPublished(uuidParam(req, 'id'), body.published);
    }),
);

// ------------------------------------------------------------ ios waitlist
adminRouter.get(
    '/ios-waitlist',
    route(200, async (req) => admin.listIosWaitlist(pageRequest(req), queryText(req, 'q'))),
);

// ------------------------------------------------------------ email queue
adminRouter.get(
    '/emails',
    route(200, async (req) => admin.listEmails(pageRequest(req), queryText(req, 'status'))),
);
adminRouter.post(
    '/emails/:id/retry',
    route(204, async (req) => {
        if (!req.params.id) throw badRequest('id is required');
        await admin.retryEmail(uuidParam(req, 'id'));
    }),
);

// ======================================================== actions (audited)
const emailParam = (req: { params: Record<string, string> }) => {
    const value = decodeURIComponent(req.params.email ?? '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(value) || value.length > 320) throw badRequest('email is invalid');
    return value;
};

// users
adminRouter.post(
    '/users/:id/suspend',
    route(204, async (req) => {
        const body = parseBody(z.object({ reason: z.string().trim().max(300).optional() }), req.body);
        await actions.setUserSuspended(actor(req), uuidParam(req, 'id'), true, body.reason || null);
    }),
);
adminRouter.post(
    '/users/:id/restore',
    route(204, async (req) => actions.setUserSuspended(actor(req), uuidParam(req, 'id'), false, null)),
);
adminRouter.patch(
    '/users/:id',
    route(204, async (req) => {
        const body = parseBody(z.object({ displayName: text(100).min(2) }), req.body);
        await actions.renameUser(actor(req), uuidParam(req, 'id'), body.displayName);
    }),
);
adminRouter.post(
    '/users/:id/resend-verification',
    route(204, async (req) => actions.resendVerification(actor(req), uuidParam(req, 'id'))),
);
adminRouter.post(
    '/users/:id/notify',
    route(204, async (req) => {
        const body = parseBody(z.object({ title: text(140), message: text(500) }), req.body);
        await actions.notifyUser(actor(req), uuidParam(req, 'id'), body.title, body.message);
    }),
);
adminRouter.post(
    '/users/:id/delete',
    route(204, async (req) => actions.deleteUser(actor(req), uuidParam(req, 'id'))),
);

// announcements
adminRouter.get('/announcements/audience', route(200, () => actions.audienceSizes()));
adminRouter.post(
    '/announcements',
    route(200, async (req) => {
        const body = parseBody(
            z.object({
                title: text(140),
                message: text(500),
                audience: z.enum(['all', 'verified', 'premium']),
                push: z.boolean().default(false),
            }),
            req.body,
        );
        return actions.broadcast(actor(req), body);
    }),
);

// subscriptions
adminRouter.post(
    '/subscriptions/grant',
    route(201, async (req) => {
        const body = parseBody(
            z.object({ user: text(320), planId: uuid, days: z.number().int().min(1).max(3650).nullish() }),
            req.body,
        );
        return actions.grantSubscription(actor(req), { ...body, days: body.days ?? null });
    }),
);
adminRouter.post(
    '/subscriptions/:id/cancel',
    route(204, async (req) => actions.setSubscriptionActive(actor(req), uuidParam(req, 'id'), false)),
);
adminRouter.post(
    '/subscriptions/:id/reactivate',
    route(204, async (req) => actions.setSubscriptionActive(actor(req), uuidParam(req, 'id'), true)),
);
adminRouter.post(
    '/subscriptions/:id/extend',
    route(204, async (req) => {
        const body = parseBody(z.object({ days: z.number().int().min(1).max(3650) }), req.body);
        await actions.extendSubscription(actor(req), uuidParam(req, 'id'), body.days);
    }),
);

// groups
adminRouter.patch(
    '/groups/:id',
    route(204, async (req) => {
        const body = parseBody(z.object({ name: text(120) }), req.body);
        await actions.renameGroup(actor(req), uuidParam(req, 'id'), body.name);
    }),
);
adminRouter.post(
    '/groups/:id/delete',
    route(204, async (req) => actions.deleteGroup(actor(req), uuidParam(req, 'id'))),
);

// releases, waitlist, email queue
adminRouter.post(
    '/app-versions/:id/delete',
    route(204, async (req) => actions.deleteAppVersion(actor(req), uuidParam(req, 'id'))),
);
adminRouter.get('/ios-waitlist/export', route(200, () => actions.exportWaitlist()));
adminRouter.post(
    '/ios-waitlist/:email/remove',
    route(204, async (req) => actions.deleteWaitlistEntry(actor(req), emailParam(req))),
);
adminRouter.post(
    '/emails/:id/discard',
    route(204, async (req) => actions.discardEmail(actor(req), uuidParam(req, 'id'))),
);

// activity log and admin accounts
adminRouter.get(
    '/audit',
    route(200, async (req) => actions.listAudit(pageRequest(req), queryText(req, 'action'))),
);
adminRouter.get('/admins', route(200, () => actions.listAdmins()));
adminRouter.post(
    '/admins',
    route(201, async (req) => {
        const body = parseBody(
            z.object({
                email,
                displayName: text(100).min(2),
                password: z.string().min(10, 'must be at least 10 characters').max(72),
            }),
            req.body,
        );
        return actions.addAdmin(actor(req), body);
    }),
);
adminRouter.post(
    '/admins/:id/disable',
    route(204, async (req) => actions.setAdminDisabled(actor(req), uuidParam(req, 'id'), true)),
);
adminRouter.post(
    '/admins/:id/enable',
    route(204, async (req) => actions.setAdminDisabled(actor(req), uuidParam(req, 'id'), false)),
);
adminRouter.post(
    '/auth/password',
    route(204, async (req) => {
        const body = parseBody(
            z.object({ current: notBlank(200), next: z.string().min(10, 'must be at least 10 characters').max(72) }),
            req.body,
        );
        await actions.changeOwnPassword(actor(req), body.current, body.next);
    }),
);

adminRouter.post(
    '/expenses/:id/delete',
    route(204, async (req) => actions.adminDeleteExpense(actor(req), uuidParam(req, 'id'))),
);
adminRouter.get(
    '/claims',
    route(200, async (req) => admin.listClaims(pageRequest(req), queryText(req, 'status'))),
);
adminRouter.get(
    '/invoices',
    route(200, async (req) => admin.listInvoices(pageRequest(req), queryText(req, 'q'))),
);
adminRouter.get(
    '/pay-links',
    route(200, async (req) => admin.listPayLinks(pageRequest(req), queryText(req, 'state'))),
);
adminRouter.post(
    '/pay-links/:id/revoke',
    route(204, async (req) => {
        const code = String(req.params.id);
        if (!/^[A-Za-z0-9]{8,16}$/.test(code)) throw badRequest('Invalid link');
        await actions.revokePayLink(actor(req), code);
    }),
);
adminRouter.post(
    '/attachments/:id/remove',
    route(204, async (req) => actions.removeAttachment(actor(req), uuidParam(req, 'id'))),
);

// ----------------------------------------------------------------- email
const Draft = z.object({
    subject: text(200),
    heading: text(200),
    body: text(10_000),
    buttonLabel: z.string().trim().max(60).nullish().transform((v) => v || null),
    buttonUrl: z
        .string()
        .trim()
        .max(2000)
        .regex(/^https?:\/\//i, 'must be an http(s) address')
        .nullish()
        .or(z.literal('').transform(() => null))
        .transform((v) => v || null),
    footer: z.string().trim().max(500).nullish().transform((v) => v || null),
});

adminRouter.get('/mail/templates', route(200, async () => campaign.TEMPLATES));
adminRouter.get('/mail/audiences', route(200, () => campaign.audienceSizes()));
adminRouter.post(
    '/mail/preview',
    route(200, async (req) => campaign.preview(parseBody(Draft, req.body))),
);
adminRouter.post(
    '/mail/test',
    route(204, async (req) => campaign.sendTest(actor(req), parseBody(Draft, req.body))),
);
adminRouter.post(
    '/mail/send',
    route(200, async (req) => {
        const body = parseBody(
            Draft.and(
                z.object({
                    audience: z.enum(['user', 'all', 'verified', 'premium', 'ios-waitlist', 'admins']),
                    userId: uuid.optional(),
                    templateId: z.string().regex(/^[a-z-]{1,30}$/).optional(),
                }),
            ),
            req.body,
        );
        return campaign.send(actor(req), body);
    }),
);
