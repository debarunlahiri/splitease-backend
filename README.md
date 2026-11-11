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

## Layout

```
migrations/001_init.sql        whole schema, one database
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
  middlewares/                 authenticate, idempotency, request-log, error-handler
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
- `currency` / `defaultCurrency` and share values for EXACT and PERCENTAGE splits are
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
