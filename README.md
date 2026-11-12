# SplitEase backend (Node.js monolith)

One Node.js + TypeScript + PostgreSQL service that replaces the Spring Boot
microservices (gateway, discovery, identity, group, expense, settlement, notification,
subscription). The public HTTP API is the same: same paths, request and response
bodies, status codes and error format, so existing clients keep working.

## Run

Requires Node.js 20+ and PostgreSQL 13+.

```bash
cp .env.example .env
```

```bash
docker compose up -d
```

```bash
npm install
```

```bash
npm run dev
```

`npm run dev` runs the server under nodemon (`nodemon.json`). It restarts automatically
when anything in `src/`, `migrations/` or `.env` changes.

The server listens on port 9890 (the old gateway port). Pending SQL files in
`migrations/` are applied on every startup (`AUTO_MIGRATE=true`, the default), so in dev
a new migration file is applied as soon as nodemon restarts. Applied files are recorded
in `schema_migrations`; never edit one that has run, add a new numbered file instead
(`002_add_something.sql`). `npm run migrate` applies them without starting the server. For production: `npm run build`, then `npm start`.

## Production (AWS Lightsail, 24/7)

Don't run `nodemon` in production: it is a dev tool and dies with your SSH
session. Run the compiled build under PM2, which restarts it on crashes and
after reboots.

```bash
sudo npm install -g pm2          # once
npm ci && npm run build
pm2 start npm --name splitease-backend -- start
pm2 startup                      # run the sudo command it prints, once
pm2 save
```

Useful commands:

```bash
pm2 status
pm2 logs splitease-backend
git pull && npm ci && npm run build && pm2 restart splitease-backend   # deploy
```

On small instances (512 MB / 1 GB) add a swap file, or the process can be
killed for running out of memory.

## Browser access

Set `APP_URL` in the backend environment to the comma-separated list of allowed
web origins. Include the scheme and any non-default port. Local development
defaults to `http://localhost:3000`. The first entry also sets the base URL for
email and group invite links.

## Expense attachments

Each expense can contain five files, up to 10 MiB per file. Migration
`006_expense_attachments.sql` adds attachment storage. If the API is behind a
reverse proxy, allow requests of at least 10 MiB on the attachment upload route.

## Admin dashboard

The dashboard lives in the website project (`splitease-web`, under `/admin`). This service
provides its API under `/api/v1/admin`. Admins are separate from app users: their own table
(`admin_users`), their own sign-in and their own token secret, so an admin token can never act
as an app user and the other way round. The website calls this API from its server, so no CORS
settings are needed for it.

### Turn it on

1. Set a secret of at least 32 characters in `.env`. Without it the admin API stays off
   (every admin request answers 503).

   ```bash
   echo "ADMIN_JWT_SECRET=$(openssl rand -base64 36 | tr -d '\n')" >> .env
   ```

   `ADMIN_JWT_LIFETIME` (default `PT8H`) sets how long an admin stays signed in.

2. Apply the migrations (`008_admin_users.sql` and `009_admin_actions.sql`). They run on
   startup, or on demand:

   ```bash
   npm run migrate
   ```

3. Create the first admin. A random password is printed once, so save it:

   ```bash
   npm run admin -- --email you@example.com --name "Your Name"
   ```

   Pass `--password <text>` (at least 10 characters) to choose your own. More admins can be
   added later in the dashboard (Admins page).

4. Sign in on the website at `/admin`. Change the password afterwards (Admins, then
   "Change my password").

Forgot the password, or the account was disabled:

```bash
npm run admin -- --email you@example.com --name "Your Name" --reset
```

### Deploying it to production

The server runs the compiled code in `dist/`, not the source. Running `npm run admin` works from
source, so it succeeding does not mean the running server knows the admin routes. After pulling
or copying new code, always rebuild and restart:

```bash
npm ci && npm run build && pm2 restart splitease-backend
```

Redeploy the website as well (see its README), so the login page and the `/admin` pages exist.

### Troubleshooting sign-in

Test the backend directly on the server (use your real password):

```bash
curl -i -X POST http://localhost:9890/api/v1/admin/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"YOUR_PASSWORD"}'
```

| Answer | Meaning | Fix |
| --- | --- | --- |
| `200` with a token | The backend is fine | Redeploy the website |
| `401`, empty body | The running server is an old build without admin routes | `npm run build`, then restart |
| `401`, JSON `Invalid email or password` | Wrong password, or the server uses a different database than the script | Run the `--reset` command above; check `DATABASE_URL` |
| `429` | Five failed attempts from one address in 15 minutes | Wait 15 minutes |
| `503` | `ADMIN_JWT_SECRET` is missing or shorter than 32 characters | Set it, restart |

"An admin with that email already exists" when creating means the account is there already;
use `--reset` to set a new password.

### What admins can do

Every change is recorded in `admin_audit` (who, what, when) and shown on the Activity log page.

| Area | Actions |
| --- | --- |
| Overview | Totals, 30-day signups, spend by currency, subscription sales, items needing attention |
| Users | Search; edit name; send a notification or email; resend verification; mark email verified; sign out of all devices; suspend or restore; delete |
| Groups | Search; rename; delete (removes its expenses, settlements and balances) |
| Expenses | List per group (including deleted); view split, history and attachments; delete (uses the app's own delete, so balances are reversed); remove an attachment |
| Subscriptions | List; grant a plan free of charge; extend; cancel or reactivate |
| Plans | Create, edit, hide or show, delete (only plans never subscribed to) |
| Announcements | Send an in-app notification, with optional push, to everyone, verified or premium users |
| Send email | Templated, formal emails to one user, an audience, the iOS waitlist or the admins (see below) |
| App releases | Publish, withdraw, delete (same table as `npm run app-version`) |
| iOS waitlist | Search, remove, export CSV |
| Email queue | View delivery state, retry failed emails, discard unsent ones |
| Admins | Add, disable or enable, change your own password |

Safety rules built into the API:

- **Suspending** a user revokes their refresh tokens and blocks sign-in, token refresh and Google
  sign-in. An access token they already hold keeps working until it expires (`JWT_LIFETIME`,
  1 hour by default).
- **Deleting a user** only works for accounts that never joined a group or expense. Otherwise it
  answers 409 and you suspend instead, because deleting would break other people's balances.
- **Deleting an expense** goes through the app's expense service, so balance projections and
  events stay consistent. The event is attributed to the payer, because app events need an app
  user id; the audit log records which admin really did it.
- **Email bodies** are never returned by the API (they can hold sign-in links and codes).
- **Attachments** are served inline only for PNG, JPEG, GIF, WebP and PDF; any other type is
  forced to download. Responses are `no-store`.
- The last enabled admin cannot be disabled, and admins cannot disable themselves.

### Admin API

All routes are under `/api/v1/admin` and need `Authorization: Bearer <admin token>`, except
`POST /auth/login`.

| Area | Routes |
| --- | --- |
| Auth | `POST /auth/login`, `GET /auth/me`, `POST /auth/password` |
| Overview | `GET /overview` |
| Users | `GET /users`, `GET /users/:id`, `PATCH /users/:id`, `POST /users/:id/{suspend,restore,delete,revoke-sessions,verify-email,resend-verification,notify}` |
| Groups | `GET /groups`, `GET /groups/:id`, `PATCH /groups/:id`, `POST /groups/:id/delete`, `GET /groups/:id/expenses` |
| Expenses | `GET /expenses/:id`, `POST /expenses/:id/delete`, `GET /attachments/:id`, `POST /attachments/:id/remove` |
| Subscriptions | `GET /subscriptions`, `POST /subscriptions/grant`, `POST /subscriptions/:id/{cancel,reactivate,extend}` |
| Plans | `GET /plans`, `POST /plans`, `PATCH /plans/:id`, `POST /plans/:id/delete` |
| Announcements | `GET /announcements/audience`, `POST /announcements` |
| Email | `GET /mail/templates`, `GET /mail/audiences`, `POST /mail/{preview,test,send}` |
| Releases | `GET /app-versions`, `POST /app-versions`, `PATCH /app-versions/:id`, `POST /app-versions/:id/delete` |
| Other | `GET /ios-waitlist`, `GET /ios-waitlist/export`, `POST /ios-waitlist/:email/remove`, `GET /emails`, `POST /emails/:id/{retry,discard}`, `GET /audit`, `GET/POST /admins`, `POST /admins/:id/{enable,disable}` |

### Sending email from the dashboard

Code: `src/services/campaign.service.ts` (templates, audiences, sending) and
`composedEmail` in `src/services/mail.service.ts` (the shared branded layout).

- **Templates** (each with a subject and a formal body): promotion, new feature, account warning,
  account suspension, security alert, Terms and Privacy update, scheduled maintenance,
  subscription reminder, feedback request, "we miss you", iOS launch, and a blank message.
- **Variables:** `{{name}}` and `{{email}}` are replaced for each recipient. A blank line starts
  a new paragraph and lines starting with `- ` become bullets. Everything is HTML-escaped.
- **Placeholders:** text in `[[double brackets]]` must be filled in. The API refuses to send a
  draft that still contains one.
- **Audiences:** one user, all users, verified, premium, the iOS waitlist (confirmed only) or
  admins. Suspended users are excluded. One send is limited to 5,000 recipients.
- **Delivery:** messages go through the normal `email_queue`, so they are retried like any other
  email. With no SMTP settings they are only written to the log, and the dashboard warns you.
- **Promotions:** there is no unsubscribe list yet. Only email people who agreed to promotions,
  and honour requests to stop.

## Layout

```
migrations/001_init.sql        whole schema, one database (later files add to it)
src/
  server.ts                    startup, background jobs, graceful shutdown
  app.ts                       Express app: middleware order + routes
  config/
    index.ts                   environment variables and validation
    firebase.ts                Firebase Admin app (sign-in and push)
  database/
    index.ts                   pg pool, transactions, advisory locks
    migrate.ts                 applies migrations/*.sql
  routes/                      URL -> controller wiring, one file per area
                               (admin.routes.ts holds the whole admin API)
  controllers/                 read the request, call a service, return the result
  validators/                  zod request schemas (common.ts = shared rules)
  services/                    business logic and SQL
    auth.service.ts            accounts, tokens, login throttle, Firebase sign-in
    group.service.ts           groups, invitations, invite links, membership
    expense.service.ts         expenses, audit history
    settlement.service.ts      payments, balances, debt suggestions, projection
    notification.service.ts    inbox, preferences, event handlers, push dispatcher
    subscription.service.ts    plans, entitlement, purchase + webhook handling
    store-verification.service.ts   Google Play and App Store verification
    admin.service.ts           admin sign-in, dashboard reads (users, groups, expenses, ...)
    admin-actions.service.ts   audited admin changes (suspend, delete, grant, plans, ...)
    campaign.service.ts        admin email templates, audiences and sending
  middlewares/                 authenticate, idempotency, request-log, error-handler
  scripts/                     app-version (releases), create-admin (npm run admin)
  events/                      transactional outbox, in-process dispatcher, event types
  utils/                       errors, http helpers, logger, tokens, money, split-calculator
  types/                       Express request typing
```

Request flow: `routes` -> `controllers` (validate with `validators`) -> `services` -> database.
Write endpoints use the `idempotent` middleware, so their controller receives a
transaction connection that also stores the replayable response.

## What changed from the microservices

| Microservices | Monolith |
| --- | --- |
| Six databases | One database, `splitease`. Same tables and columns. |
| Gateway validates the JWT and forwards `X-User-Id` / `X-User-Email` | `src/middlewares/authenticate.ts` validates the JWT and sets `req.user`. Identity headers from callers are ignored. |
| Eureka discovery | Not needed. |
| `/internal/v1/...` endpoints + `INTERNAL_SERVICE_KEY` | Direct function calls between modules; the endpoints and the key are gone. |
| Kafka topics and listeners | The outbox table stays. A dispatcher in this process delivers each event to its consumers (balance projection, notifications) every `OUTBOX_PUBLISH_DELAY`. |
| One `processed_events` table per consuming service | One table keyed by `(consumer, event_id)`. |
| One `api_idempotency` and `outbox_events` table per service | One of each. |
| Redis | Was configured but unused; dropped. |

Behaviour that is kept: refresh-token rotation with reuse detection, login throttling,
email verification, Firebase Google sign-in, `Idempotency-Key` on write endpoints,
expense split rules, expense audit history, revision-guarded balance projection,
debt simplification, invitation alerts for not-yet-registered emails, FCM push with
retry backoff, Google Play and App Store purchase verification and webhooks, and the
sanitized `API_AUDIT` request log.

Balances reflect expense changes as soon as the write commits. Payment balance
updates and notifications are processed by the outbox dispatcher.

Android push delivery requires `PUSH_DELIVERY_ENABLED=true`, `FIREBASE_PROJECT_ID`,
and Firebase Admin credentials for the same project as the Android app. The
recipient must also enable push in the app and grant Android notification permission.

## Small differences

- JSON money values are still numbers. Amounts with more than two decimal places are
  now rejected with 400 instead of being silently rounded by the database.
- `currency` / `defaultCurrency` and share values for EXACT, PERCENTAGE and SHARES splits are
  required (the Java service answered 500 when they were missing).
- Access tokens are signed with HS256. Tokens issued by the Java service with the same
  `JWT_SECRET` are still accepted.
- `DATABASE_URL` is a `postgres://` URL, not a JDBC URL.
- Emails are really sent now (see below). The old `EMAIL_VERIFICATION_LOGGING_ENABLED`
  setting is gone.

## Email

Configure `SMTP_*`, `MAIL_FROM_NAME` and `APP_URL` in `.env` (see `.env.example`).
Mail code is in `src/services/mail.service.ts`. Emails sent:

| Email | When |
| --- | --- |
| Verify your email | after registering, and on `/auth/resend-verification` |
| Welcome | after the email is verified, and on first Google sign-in |
| Group invitation | when an owner invites an email address |
| Friend invitation | when someone sends an invitation from Friends |
| Friend or group membership confirmed | when the recipient connects or joins |
| Payment recorded | to the payee when a settlement is recorded |

Links point at the first `APP_URL` entry. Verification uses `/verify-email?token=...`,
welcome emails use `/open`, group invitations use `/invite`, and friend invitations
use `/friend` with a token in the URL fragment. The verification
email also shows the code for clients that ask the user to paste it.

For direct Android opening from email, put `https://splitease.lambrk.com` first in
production `APP_URL` and publish the matching app signing certificate fingerprint
through the web app's `/.well-known/assetlinks.json` route.

Emails go through a database queue (`email_queue`) and a background worker, so a mail
failure never undoes a registration, invitation or payment, and nothing is lost if the
server restarts. A failed email is retried 30s, 1m, 2m, 4m ... (up to 1h) after the
previous try, up to `MAIL_MAX_ATTEMPTS` (default 8, about two hours in total). It is
dropped immediately when the server says the address is permanently invalid. A wrong
SMTP login is retried, so fixing `.env` and restarting delivers what is still queued.
The body of an email is erased from the table once it is sent or given up on.

If SMTP is not configured, emails are written to the log instead (including the
verification code) so local development still works.

## Moving existing data

The table definitions match the old services, so each old database can be copied
into the new one with `pg_dump --data-only` / `psql`. Three tables need care because
they were merged:

- `processed_events`: has a new `consumer` column. Use `settlement-balance-projection`
  for rows from the settlement database and `notification-service` for rows from the
  notification database.
- `outbox_events`: copy only after the old publishers have drained (all rows have
  `published_at`), or the events will be delivered a second time. Redelivery is
  harmless only if `processed_events` was copied too.
- `api_idempotency`: optional; rows from the different services can be merged.

Do not copy the `plans` seed rows twice; the migration already inserts them.

## App updates (Android, self-hosted)

`GET /api/v1/app/version` (public) tells the Android app which version is the latest and where to
download its APK. The versions live in the database table `app_versions`; the newest published row
is the latest. No restart is needed after changing it.

Publish a release with the script (it also creates the table if needed):

```bash
npm run app-version -- --code 2 --name 1.1 --min 1 \
  --url https://splitease.lambrk.com/downloads/splitease.apk \
  --apk ./splitease.apk --notes "Faster balances\nBug fixes"
```

`--apk` computes the SHA-256 for you (or pass `--sha256 <hex>`). The app checks it before it
installs anything. Other commands:

```bash
npm run app-version -- --list
```

```bash
npm run app-version -- --unpublish 2
```

`--min` is the lowest installed version code allowed to keep using the app; older versions are
forced to update. You can also edit the table directly with SQL. The APK itself is hosted
elsewhere, for example the website's `public/downloads/`.

## Expense extras (free for everyone for now)

- `splitType` also accepts `SHARES` (split by ratio; `value` is each person's share count).
- Expenses take optional `remindAfterDays` (2, 3 or 7) and `payByDate`. A background job notifies
  the payer once an expense has been open that long and the group still owes them money.
- Every share in a response has `amount`, `paidAmount` and `status` (`UNPAID`, `PARTIAL`, `PAID`).
- `POST /api/v1/expenses/:id/payments` `{ userId, amount? }` – the payer marks a person's share as
  paid (all of what is left when `amount` is omitted) and a settlement is recorded.
- `POST /api/v1/expenses/:id/notify` `{ userIds?, channels: ["PUSH","EMAIL"], message? }` – the payer
  nudges people who still owe them, in the app and/or by email.
- `GET /api/v1/expense-templates/group/:groupId`, `POST /api/v1/expense-templates`,
  `DELETE /api/v1/expense-templates/:id` – saved expense templates per user and group.
- Migrations `010_expense_extras.sql` and `011_expense_share_payments.sql` add the new columns/tables.

## Ledger

- `GET /api/v1/ledger` – what others still owe you on expenses you paid (per person, per currency, with
  the splits behind it), plus what arrived this month.
- `GET /api/v1/ledger/export.csv` – the same data as a CSV file (free for everyone for now).
- `POST /api/v1/ledger/remind` `{ userId, channels }` – one reminder covering everything a person owes you.

## Contacts as group members

- `POST /api/v1/groups/:groupId/contacts` `{ name, email?, phone? }` adds someone from the phone's
  contacts to the group so they can be part of splits before they have an account. Members expose
  `pending: true` until then. When that person accepts an email invitation for the same address,
  their splits and balances move to their account. Joining through an invite link can't be matched
  automatically (there is no email), so those contacts stay as they are.
- Migration `012_contact_members.sql` adds the contact columns to `users`. Contacts are never emailed
  (`@placeholder.invalid`) and cannot sign in.

- `GET /api/v1/groups/progress` – settle-up progress per group (`settled`/`total`, pending and collected per
  currency) plus `toCollect` / `toPay` across all groups; used for the Groups screen summary.

## UPI

- `PUT /api/v1/users/me/upi` `{ upiId }` sets (or clears with `null`/empty) the caller's UPI ID. `GET /users/me` returns
  `upiId`, and group members expose `upiId` so friends can pay in INR. Migration `013_upi_id.sql`.
- `GET /api/v1/app/links` returns `{ webUrl }`, the public website address (used for shareable pay links).
- `GET /ledger/export.csv` now has three sections: a money summary per currency (shared, paid back, pending, received), who owes you (share / paid / pending per person), and every payment you received.

## Short pay links

- `POST /api/v1/pay-links` `{ v, d, c, n, u?, t:[{n,a}], b? }` stores a split and returns `{ code, url }` where `url` is
  `<site>/p/<code>` (10 random characters, valid 90 days). The details stay on the server instead of in the URL.
- `GET /api/v1/public/pay/:code` (no sign-in) returns the stored split for the website. Migration `014_pay_links.sql`.

## Payment claims ("I've paid" and confirm)

- `POST /api/v1/expenses/:id/claims` `{ amount? }` – a signed-up person says they paid their share (all that is left when
  `amount` is omitted). The payer gets a notification. One open claim per person per expense.
- `GET /api/v1/expenses/group/:groupId/claims` – open claims in a group (those waiting on you as the payer and your own).
- `POST /api/v1/expenses/claims/:claimId/confirm` – the payer confirms the money arrived; the payment is recorded.
- `POST /api/v1/expenses/claims/:claimId/reject` – the payer says it hasn't arrived; the person is told.
- Migration `015_payment_claims.sql`.

## Per-person due dates

- Each share in a request may carry `payByDate`; responses return `dueDate` (their own date, else the expense's) per share.
  Migration `016_share_due_dates.sql`.
- `GET /ledger` also returns `youOwe` (what you owe each person, with their UPI ID, due dates and `overdue`) and `stillToPay`;
  the splits in `people` now carry `dueDate` and `overdue`. Pay links accept a per-person `d` due date.

## UPI ID checks

- `PUT /users/me/upi` now checks the shape of the UPI ID (one `@`, 3+ characters before it, only valid characters, a handle
  like `ybl` or `oksbi` after it, not an email address) and answers 400 with a reason. `GET /users/me` returns `upiVerified`
  and `upiHandleKnown`; members expose `upiVerified`. Changing the ID resets verification. Migration `017_upi_verified.sql`.
- `POST /users/me/upi/confirm` records that the owner saw their own name in a UPI app for this ID. This is a self-confirmation:
  checking with the bank would need a payment gateway's "validate VPA" API and its credentials.
- `GET /ledger/export.xlsx` – the same ledger as a formatted Excel workbook (Summary, Who owes you, Payments received): coloured headers, currency formats, colour-coded status and overdue dates, frozen header row and filters.
- Ledger exports take `?scope=all|owed|owe` (default `all`): `owed` = what others owe you, `owe` = what you owe. File names are unique, e.g. `splitease-ledger-owed-to-you-20261112-203015.xlsx`.
- `GET /api/v1/public/pay/:code/invoice/:index` (no sign-in) returns an invoice/receipt for one person on a pay link (number, date, items, paid, balance) once something has been paid.

## Invoices

- Invoices are stored records with their own number (`SE-2026-000123`, from a database sequence). The first time an invoice is
  made for a person it gets its number and keeps it; later payments update the amounts and status. Migration `018_invoices.sql`.
- `GET /api/v1/invoices?q=` lists invoices you issued or were billed on, newest first; `q` matches the number, a name, the group or an item.
  Admins can search all of them at `GET /api/v1/admin/invoices?q=`.
