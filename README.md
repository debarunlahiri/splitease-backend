# SplitEase Backend

SplitEase is a Java 21 and Spring Boot microservice backend for shared expenses, group balances, settlements, notifications and optional paid no-ads entitlements. The native Android client uses Jetpack Compose, Material 3 Expressive and Google sign-in through Firebase.

## Contents

- [Quick start](#quick-start)
- [Services and ports](#services-and-ports)
- [API addresses and Android connection](#api-addresses-and-android-connection)
- [Databases and infrastructure](#databases-and-infrastructure)
- [Configuration](#configuration)
- [Startup and shutdown behavior](#startup-and-shutdown-behavior)
- [Development auto-reload](#development-auto-reload)
- [Authentication and Firebase](#authentication-and-firebase)
- [Duplicate request protection](#duplicate-request-protection)
- [API routes](#api-routes)
- [Console and database logging](#console-and-database-logging)
- [Architecture and business rules](#architecture-and-business-rules)
- [Email authentication security](#email-authentication-security)
- [Google Play notification setup](#google-play-notification-setup)
- [Apple verification setup](#apple-verification-setup)
- [Push delivery setup](#push-delivery-setup)
- [Troubleshooting](#troubleshooting)
- [Repository layout](#repository-layout)
- [Verification and limitations](#verification-and-limitations)

## Quick start

Run commands from the backend checkout:

```bash
# Development: startup, live logs, and rebuild/restart on source changes
./dev.sh

# Standard startup with live service/API logs
./start.sh

# Start and return to the prompt
./start.sh --detach

# Stop services, flush logs, and stop this project's infrastructure
./stop.sh
```

`./start.sh --watch` is equivalent to `./dev.sh`. Use one startup command at a time. Ctrl+C stops following/watching while leaving existing services and the collector running; use `./stop.sh` for shutdown.

Dependencies: Python 3, an installed JDK 21+, Maven 3.6.3+, Docker Engine/Desktop with Compose v2, and `lsof`. The scripts check tools but do not install them. Docker Desktop auto-start is supported on macOS.

```bash
./start.sh --timeout 300 --docker-timeout 300
./dev.sh --timeout 300
```

Both timeouts default to 180 seconds. `--timeout` is the readiness timeout per Java service; `--docker-timeout` controls the Docker Desktop startup wait. `--watch` requires foreground startup and cannot be combined with `--detach`.

## Services and ports

| Service | Port | Responsibility |
|---|---:|---|
| Discovery | 9897 | Eureka service registry |
| API Gateway | 9890 | JWT verification, routing, identity forwarding |
| Identity | 9891 | Registration, login, access tokens, user profiles |
| Groups | 9892 | Groups, membership, invitations |
| Expenses | 9893 | Expenses and exact/equal/percentage splits |
| Settlements | 9894 | Balances, simplified debts, payment records |
| Subscriptions | 9895 | Server-controlled plans and no-ads entitlements |
| Notifications | 9896 | Kafka-backed notification inbox |

Each business service owns a separate PostgreSQL database. Kafka carries domain events, Redis stores short-lived entitlement data, and the gateway is the only public entry point.

## API addresses and Android connection

| Client | Gateway root | API base URL |
|---|---|---|
| On the Mac | `http://localhost:9890/` | `http://localhost:9890/api/v1/` |
| Android emulator | `http://10.0.2.2:9890/` | `http://10.0.2.2:9890/api/v1/` |
| Physical device on the same LAN | `http://<Mac-LAN-IP>:9890/` | `http://<Mac-LAN-IP>:9890/api/v1/` |

The development LAN address used in the Android configuration is `192.168.0.135`; it can change when the network changes. The phone must reach that address on the same network.

The Android checkout is `/Users/debarunlahiri/AndroidStudioProjects/Splitease`. Set its Gradle property to the gateway root:

```properties
SPLITEASE_API_URL=http://192.168.0.135:9890/
```

The Android client supports HTTP and HTTPS, permits cleartext traffic, adds `/api/v1/` automatically and normalizes an existing `/api/v1/` suffix. An emulator can instead use `http://10.0.2.2:9890/`. Rebuild/reinstall the Android app after changing BuildConfig or manifest settings. See the Android project's README for its screen/form/navigation structure and Firebase client setup.

## Databases and infrastructure

| Database | Owner/use |
|---|---|
| `splitease_identity` | Accounts, Firebase identity links, sessions and verification |
| `splitease_groups` | Groups, members and invitations |
| `splitease_expenses` | Expenses, splits, audit history and outbox |
| `splitease_settlements` | Payments, balance projections and outbox |
| `splitease_subscriptions` | Plans, subscriptions and store notifications |
| `splitease_notifications` | Inbox, preferences, deduplication and push queue |
| `splitease_logs` | Application logs and structured API audit events |

For a database client on the Mac, use **host `127.0.0.1`, port `15432`**, select a database above, and use `POSTGRES_USER`/`POSTGRES_PASSWORD` from `.env`. PostgreSQL listens on 5432 inside its Docker container; Compose publishes it only at `127.0.0.1:15432` to avoid the existing host PostgreSQL on 5432. Kafka uses `localhost:9092`; Redis uses `localhost:6379`.

Startup creates missing databases even on previously initialized volumes. Each business service uses Flyway migrations under `<module>/src/main/resources/db/migration`; Hibernate validates the result. Add a new migration for schema updates rather than editing applied migrations. Do not use Flyway repair, schema deletion or volume deletion to bypass migration errors without diagnosing them. Log database schema setup is in `scripts/log_schema.sql` and is idempotent.

Normal start/stop preserves PostgreSQL and Redis volumes. Do not change credentials in `.env` expecting PostgreSQL to reset an existing volume's role/password.

## Configuration

When `.env` is missing, startup creates it privately from `.env.example` and generates random database/JWT/internal-service secrets. If copying the example yourself, replace all example secrets before startup. Existing `.env` values are preserved, and exported shell variables take precedence. Values are literal data with optional surrounding quotes; no shell execution or variable interpolation occurs.

| Setting | Purpose |
|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD` | Database credentials; retain them for existing volumes |
| `JWT_SECRET`, `INTERNAL_SERVICE_KEY` | Distinct application secrets, at least 32 bytes |
| `FIREBASE_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS` | Firebase Admin project and server credential path |
| `REFRESH_TOKEN_LIFETIME` | Refresh-session duration; default `P30D` |
| `EMAIL_VERIFICATION_LIFETIME` | Email verification lifetime; default `PT24H` |
| `EMAIL_VERIFICATION_LOGGING_ENABLED` | Local verification sender; default `true` |
| `LOGIN_MAXIMUM_ATTEMPTS` | Failed-login threshold; default `5` |
| `LOGIN_ATTEMPT_WINDOW`, `LOGIN_BLOCK_DURATION` | Throttle durations; both default `PT15M` |
| `GROUP_INVITATION_LIFETIME` | Invitation lifetime; default `P7D` |
| `API_LOG_BODY_LIMIT` | Captured bytes per direction; default `16384`, capped at `65536` |
| `SPRING_PROFILES_ACTIVE` | Watch mode defaults to `dev` if unset |
| `PUSH_DELIVERY_ENABLED`, `PUSH_DISPATCH_DELAY` | Optional push adapter and dispatch schedule |
| `GOOGLE_PLAY_*`, `APPLE_*` | Optional store verification settings; see provider setup below |

The local launcher rejects `DATABASE_URL`, `SPRING_DATASOURCE_URL` and `SERVER_PORT` overrides, and pins local Eureka, groups-service, Kafka and Redis addresses. It is intended for this checkout's local Compose infrastructure, not arbitrary externally managed deployments. Credentials and local runtime files are ignored by Git.

## Startup and shutdown behavior

From this checkout, run:

```bash
./start.sh
./stop.sh
```

`start.sh` checks `lsof`, Python 3, Java 21+, Maven 3.6.3+, Docker Engine and Docker Compose v2. Maven must use Java 21+ too. The launcher automatically discovers an installed JDK 21+ (preferring 21), sets JAVA_HOME and PATH for Maven and all services, and leaves your shell configuration untouched. On macOS it opens Docker Desktop if the daemon is not running and waits for readiness. Use `--docker-timeout 300` for a slower Docker startup. Docker Desktop must already be installed; on Linux start Docker Engine yourself. The stop command never opens Docker Desktop. The script does not install system software.

On first use it creates a private `.env` from `.env.example` with random PostgreSQL, JWT and internal-service secrets. Existing `.env` values are preserved; replace example secrets before starting. Shell environment values override `.env`. Values are treated as literal data, with optional surrounding quotes and no shell execution or variable expansion. For an existing PostgreSQL volume, keep the original database username/password: changing environment variables does not reset credentials already stored in PostgreSQL.

Startup resolves Maven dependencies and builds all services with tests skipped. The parent Maven configuration binds Spring Boot repackaging for service modules. If dependency resolution or compilation fails, the current running stack is left alone. After a successful build, the launcher:

1. Finds and stops this checkout's Java services, including marked launcher processes, absolute JAR launches, and IDE/Maven launches with this checkout's `target/classes` paths.
2. Clears TCP listeners on ports 9890–9897, including unrelated processes, using SIGTERM and then SIGKILL when required. Stops this Compose project's containers and brings PostgreSQL, Kafka and Redis back up. It waits for each dependency to respond.
3. Creates any missing `splitease_*` databases, including on previously initialized volumes, and verifies PostgreSQL password authentication.
4. Starts discovery, groups, identity, expenses, settlements, subscriptions, notifications and gateway in dependency order.
5. Enables Flyway and Hibernate validation. Flyway creates missing tables from versioned migrations and applies pending migration files before service readiness succeeds. Existing applied migrations are validated; migration errors stop startup. New schema changes must be supplied as new Flyway migrations rather than editing applied files.
6. Starts the database log collector, recovering orphaned collectors even if their PID record is missing. Waits for every service health endpoint and gateway discovery routing. A failure or interruption after restart begins stops the partial stack.

The gateway runs at `http://localhost:9890` and discovery at `http://localhost:9897`. Logs append to `logs/<service>.log`. Runtime PID records and an exclusive lifecycle lock live in ignored `.runtime/`. A second simultaneous start/stop operation is rejected. Use `./start.sh --timeout 300` to allow a longer health timeout per service.

`stop.sh` terminates this checkout's Java services gracefully, escalating after 30 seconds if necessary, then stops this Compose project's containers. It does not delete PostgreSQL/Redis volumes or stop processes outside this checkout during shutdown. Java services are stopped even when Docker is unavailable; the command reports the container shutdown failure. Existing infrastructure managed under a different Compose project name is outside this launcher's ownership.

These scripts target the local ports and infrastructure in `compose.yml`, not externally managed databases. `DATABASE_URL`, `SPRING_DATASOURCE_URL` and `SERVER_PORT` overrides are rejected to avoid routing multiple services to the same database or port. The launcher pins local Kafka, Redis, Eureka and groups-client addresses. Configure Firebase, push and store-provider credentials separately when enabling those integrations; the script cannot provision provider accounts or credentials.

Only the eight application HTTP ports are forcibly cleared. The launcher does not terminate your separate PostgreSQL server on 5432 or arbitrary infrastructure port listeners. It reports permission failures. It creates `splitease_logs` and prepares logging tables/views separately from business-service Flyway migrations.

## Development auto-reload

Run `./dev.sh`, or equivalently `./start.sh --watch`. This performs the normal initial startup, streams logs and then polls development files with an 800 ms debounce. It needs no Node.js or third-party file watcher. Watch mode defaults `SPRING_PROFILES_ACTIVE` to `dev`, preserving an explicitly configured profile.

The watcher observes each module's `src/main` tree and `pom.xml`, plus the root `pom.xml`, `.env` and `serviceAccountKey.json`. Additions, modifications and deletions are detected. Build outputs, log files, `.runtime`, editor files outside the source tree and tests are excluded, so normal compilation/logging cannot trigger reload loops.

- Service-only changes rebuild that service and its Maven dependencies, then restart that service.
- `common` changes rebuild/restart its six dependent business services.
- Discovery changes restart only discovery; the other services reconnect through Eureka.
- `.env` changes restart only services using the keys whose effective values changed. Configuration/credential-only changes do not run Maven. For example, `FIREBASE_PROJECT_ID` restarts identity; `GOOGLE_APPLICATION_CREDENTIALS` or the root `serviceAccountKey.json` restarts identity and subscriptions.
- Editing `.env.example` or making a comment-only `.env` change does not restart services.
- The parent POM is shared by all modules, so its changes rebuild/restart all eight services.
- Rebuilds finish before running processes are stopped. Compilation errors leave running processes untouched. Runtime/migration failures are printed and the watcher stays active so another save can retry; other services, Docker infrastructure and the database log collector remain running.

Reloads reuse local infrastructure and apply pending Flyway migrations during service startup. They are rebuild-and-restart operations, not in-process class replacement, so an affected service can briefly be unavailable. Database/Docker credential or infrastructure changes still require a full `./dev.sh` restart; watcher reloads do not recreate containers. Logging continues during reloads. The lifecycle lock coordinates reloads with start/stop commands.

Ctrl+C stops watching/following and leaves existing services running. `./stop.sh` stops the backend; the watcher exits when the collector is stopped. `--watch` cannot be combined with `--detach`. Normal `./start.sh` remains unchanged and does not watch files.

## Authentication and Firebase

The Android source lives at `/Users/debarunlahiri/AndroidStudioProjects/Splitease`.
`POST /api/v1/auth/firebase` accepts `{ "idToken": "<Firebase ID token>" }` and returns the existing `AuthResponse` access token, rotating refresh token, expiration timestamps, and user object. It verifies signature, audience, expiry, revocation/disabled status, verified email, and the `google.com` sign-in provider through Firebase Admin before issuing a backend session. The gateway continues to accept only backend JWTs for protected routes.

Set `FIREBASE_PROJECT_ID` and provide Application Default Credentials for that project. Missing project configuration returns HTTP 503 and does not prevent the existing email login workflow from starting. Apply the new identity Flyway migration `V3__firebase_identity.sql`. Firebase UID is a unique durable identity; existing email/password accounts are never silently linked by email. An existing-email collision returns HTTP 409 and requires a separate explicit account-linking workflow or controlled migration.

Google provider registration, Android signing fingerprints, and `google-services.json` are documented in the Android README. Keep service-account credentials on the server. Provider sign-in and end-to-end security behavior require separate integration verification.

For project `splitease-279d9`, configure the backend environment:

```dotenv
FIREBASE_PROJECT_ID=splitease-279d9
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/firebase-admin-service-account.json
```

Obtain the server-only file from Firebase Console → Project settings → Service accounts → Generate new private key. It contains `type: service_account`. The Android `google-services.json` contains `project_info` and `client` sections and belongs at `app/google-services.json` in the Android project; placing it in the backend does not provide Admin credentials. Keep private keys out of the app and Git. See [Firebase Admin setup](https://firebase.google.com/docs/admin/setup).

The launcher cannot generate provider credentials. Missing server credentials leave Google sign-in unavailable. Public 5xx errors are generic; setup details are written to server logs. The Android frontend uses fixed user-facing messages and silently dismisses sign-in cancellation instead of showing SDK codes, exception messages, IP addresses or configuration instructions.

## Duplicate request protection

Authenticated write endpoints in groups, expenses, settlements, notification preferences/read state, and purchase verification require an `Idempotency-Key` header. Generate a fresh UUID for each intended action, and reuse that UUID when retrying the same action after a timeout or lost response:

```http
POST /api/v1/expenses
Authorization: Bearer <access-token>
Idempotency-Key: 7658d90a-97dd-4e16-a08c-8e62d16f79f2
Content-Type: application/json
```

Keys accept 8–128 letters, digits, dots, colons, underscores or hyphens. Missing/invalid keys return HTTP 400. This is a contract change for authenticated write clients; the Android API client now sends keys automatically and retains them in memory for uncertain network/server outcomes. It also accepts an explicit key for callers that persist an action across app restarts. Automatic pending keys are scoped to the signed-in user and are cleared on logout. Automatic keys are retired after a definite successful response; submitting a new action after that creates a new key, even with identical data. A client requiring retry across process death must persist its explicit action key.

Each business service stores a unique `(user_id, key_hash)` reservation, request fingerprint and serialized successful response in its own PostgreSQL database. The reservation, business mutation, outbox records and response commit in the same local transaction. A retry with the same route, method, query and validated arguments replays the original result with the endpoint's original success status, without invoking the business write again. Object field order is normalized; array ordering and numeric representation remain significant. A key reused for different data or a different endpoint within the same service returns HTTP 409. Keys are scoped per user and service, rather than globally across all microservices.

Concurrent requests wait on the unique database reservation. If the original has completed, its result is replayed; a lock wait exceeding five seconds returns HTTP 409 and the client should retry with the same key. Failed mutations roll back their reservations, so a corrected retry can execute. Successful keys survive service restarts and are retained without an automatic expiry; do not purge financial-operation records unless you have explicitly defined a safe retry/retention policy. The table contains response data and should receive the same access restrictions and backup protection as business records.

Deploy the new `__api_idempotency.sql` Flyway migration in each of the five business databases before accepting writes. The local startup script applies pending migrations through normal service startup. Authentication/refresh tokens, internal reads, and store webhooks are excluded from response caching. Existing webhook/event deduplication remains responsible for those deliveries; refresh-token replay keeps its security behavior. This mechanism covers local database writes, not exactly-once execution of external provider calls.

## API routes

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/firebase/status`
- `POST /api/v1/auth/firebase`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/verify-email`
- `POST /api/v1/auth/resend-verification`
- `GET /api/v1/users/me`
- `GET /api/v1/groups?page=0&size=20`
- `POST /api/v1/groups`
- `POST /api/v1/groups/{groupId}/invitations`
- `GET /api/v1/groups/{groupId}/invitations`
- `GET /api/v1/groups/invitations/me`
- `POST /api/v1/groups/invitations/{invitationId}/accept`
- `POST /api/v1/groups/invitations/{invitationId}/decline`
- `POST /api/v1/groups/invitations/{invitationId}/revoke`
- `POST /api/v1/expenses`
- `GET /api/v1/expenses/group/{groupId}`
- `PUT /api/v1/expenses/{expenseId}`
- `DELETE /api/v1/expenses/{expenseId}`
- `GET /api/v1/expenses/{expenseId}/history`
- `GET /api/v1/settlements/group/{groupId}`
- `GET /api/v1/settlements/group/{groupId}/balances?currency=INR`
- `GET /api/v1/settlements/group/{groupId}/suggestions?currency=INR`
- `POST /api/v1/settlements`
- `GET /api/v1/subscriptions/plans`
- `GET /api/v1/subscriptions/me/entitlement`
- `POST /api/v1/subscriptions/me/purchases/verify`
- `POST /api/v1/subscriptions/webhooks/apple`
- `POST /api/v1/subscriptions/webhooks/google`
- `GET /api/v1/notifications?page=0&size=20`
- `GET /api/v1/notifications/unread-count`
- `GET /api/v1/notifications/preferences`
- `PUT /api/v1/notifications/preferences`
- `PATCH /api/v1/notifications/{notificationId}/read`

## Console and database logging

`./start.sh` now streams the application logs after all services are ready. API traffic produces detailed single-line `API_AUDIT` JSON events in the gateway log and terminal. Each event includes request ID, UTC start/completion times, method, path, safe query parameters, socket client address, authenticated user UUID, matched service route, HTTP status, duration, completion/cancellation state, error class, content types, observed byte counts, truncation flags, and redacted JSON request/response bodies. Request IDs are returned in `X-Request-Id`, forwarded to downstream services, and added to their request-thread log lines for correlation.

Bodies are bounded at 16 KiB per direction (`API_LOG_BODY_LIMIT`, capped at 64 KiB). Authentication and store-webhook bodies are omitted entirely. Credential/token/password fields, personal contact/name fields, free-text notes/descriptions/messages and receipt metadata are redacted recursively. Malformed, truncated, non-JSON, and encoded payloads are omitted rather than logged raw. Request headers including Authorization/Cookie and arbitrary query values are not copied. Direct microservice calls bypass the gateway API audit; the gateway remains the public API entry point. Byte counts cover buffers actually consumed or written, so rejected unread request bodies may show zero bytes observed.

`start.sh` also creates **`splitease_logs`**, prepares its schema from `scripts/log_schema.sql`, and starts a detached collector. All complete stdout/stderr lines from the eight application service log files are copied into **`service_logs`**. Parsed gateway audit events also populate the `api_details` JSONB column and the **`api_request_logs`** view. Build output, Docker infrastructure output and the collector's own diagnostics are not application log records. The collector's diagnostics are streamed to the terminal and retained at `logs/log-collector.log`.

Connect at `127.0.0.1:15432` using the existing PostgreSQL credentials from `.env`, database `splitease_logs`. Example queries:

```sql
SELECT recorded_at, service_name, log_text
FROM service_logs
ORDER BY id DESC
LIMIT 100;

SELECT request_id, method, path, status, duration_ms, api_details
FROM api_request_logs
ORDER BY id DESC
LIMIT 100;

SELECT service_name, log_text
FROM service_logs
WHERE api_details ->> 'requestId' = 'your-request-id'
   OR log_text LIKE '%your-request-id%'
ORDER BY id;
```

The collector commits batches before advancing `.runtime/log-cursors.json`; a crash between commit and checkpoint is deduplicated by service/file/byte-offset uniqueness. If PostgreSQL is unavailable, source log files remain on disk and the collector retries without advancing its cursor. Preserve those files and `.runtime/` until collection completes; deleting/replacing uncollected logs loses their contents. Existing application log history is imported on the first collection pass. Logging is eventually persisted, rather than synchronously blocking API responses on database writes. A process crash before a logger writes its line to disk cannot be recovered. There is no automatic data deletion or retention expiry.

Existing development email-verification lines and common credential patterns are redacted during console/database collection. Arbitrary third-party free-text logs cannot be guaranteed free of every secret, and original service files still contain the applications' own output; restrict access to both files and this database.

Press **Ctrl+C** to stop following logs while leaving the backend and collector running. Use **`./stop.sh`** to shut services down and allow the collector to flush before PostgreSQL stops. Use **`./start.sh --detach`** to start without following logs. A collector failure keeps original file logs available for retry; inspect `logs/log-collector.log` if database entries are delayed.

The collector publishes its PID/readiness only after acquiring its exclusive lock. Startup/shutdown discover collectors by the absolute script path in this checkout as well as the runtime state, so a missing/stale PID file cannot leave an orphan blocking a new collector. Never delete the lock file to bypass a running collector. Schema notices such as `relation "service_logs" already exists, skipping` are expected idempotent setup output.

## Architecture and business rules

- Money uses `BigDecimal` and ISO 4217 currency codes.
- Expense creation validates that shares add up exactly to the expense total.
- The payer can edit or delete an expense. Changes and deletions produce balance correction events; audit snapshots retain the full history.
- Expense category, notes, and receipt metadata are stored with the expense. Receipt files require a separate storage provider; this API stores only their metadata and storage key.
- Registration sends an email verification token and does not create a session. Login requires a verified email.
- Successful login returns a short-lived access token and a rotating refresh token. Refresh token reuse revokes its full token family, and logout revokes that family.
- Logout does not invalidate an already issued access token; it remains usable until its one-hour expiry.
- Login failures are throttled in PostgreSQL so limits apply across identity-service instances. The stored subject is a SHA-256 email hash.
- Inter-service ownership checks are explicit HTTP client boundaries rather than shared database access.
- Expense and settlement reads and writes authorize participants through the groups service.
- Group owners invite by email address; the invitee must accept before joining. Invitations can be declined, revoked by the owner, or expire after seven days.
- Invitation lifetime is configured with `GROUP_INVITATION_LIFETIME`. Expired invitations are marked when read or acted on; email invitations can be created before signup and are matched against the authenticated email when the recipient views or accepts them.
- Subscription prices and features are stored server-side. A mobile client should use the returned entitlement to decide whether ads are allowed.
- Google Play verification calls the Android Publisher subscriptions v2 API using Application Default Credentials.
- Google RTDN checks signed Pub/Sub tokens, the configured audience, verified service account email, subscription name, and app package, then re-fetches the purchase from Google Play.
- Store notification deduplication and subscription changes commit together; PostgreSQL transaction locks serialize duplicate deliveries and activation for the same store reference.
- Apple verification uses Apple's server library to validate signed transactions and Notification V2 payloads against configured Apple root certificates.
- Actuator health and Prometheus endpoints are exposed for operational visibility.
- Notification inbox and push preferences are per user. Inbox results are paged, and unread counts include only visible inbox records.

## Email authentication security

The included email verification sender logs tokens for local development. Set `EMAIL_VERIFICATION_LOGGING_ENABLED=false` in deployed environments and provide an `EmailVerificationSender` adapter that delivers the token through the chosen email provider. The service intentionally fails to start if verification logging is disabled without another sender.

Refresh and verification tokens are generated from secure random bytes. Only their SHA-256 hashes are stored. Login throttling defaults to five failures within 15 minutes followed by a 15-minute block; the durations and threshold are environment configurable.

## Google Play notification setup

Enable `GOOGLE_PLAY_VERIFICATION_ENABLED` only after configuring Android Publisher credentials and authenticated Pub/Sub push. Set `GOOGLE_PLAY_PUSH_AUDIENCE` to the exact audience configured on the push subscription, `GOOGLE_PLAY_PUSH_SERVICE_ACCOUNT_EMAIL` to its authentication service account, and `GOOGLE_PLAY_PUSH_SUBSCRIPTION` to its full resource name. Configure wrapped JSON delivery to `/api/v1/subscriptions/webhooks/google`. Missing push configuration fails startup when Google verification is enabled.

Subscription and voided-purchase notifications trigger a current subscriptions-v2 lookup; test notifications are acknowledged without activation. The mobile purchase must bind its obfuscated external account ID to the SplitEase user UUID. Product IDs must map to an active server plan. This adapter currently accepts one subscription line item; multi-item subscriptions need a separate entitlement policy. Tokens are hashed for persisted references and are not saved as raw purchase credentials. A successful notification returns HTTP 204 after its database transaction completes; failures allow Pub/Sub redelivery.

Provider references: [Pub/Sub push authentication](https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions) and [Google Play RTDN](https://developer.android.com/google/play/billing/rtdn-reference).

## Apple verification setup

Apple configuration, purchase verification and webhook components all use the same `stores.apple.enabled` property, controlled by `APPLE_STORE_VERIFICATION_ENABLED`. Leave it `false` until `APPLE_BUNDLE_ID`, `APPLE_APP_ID`, `APPLE_STORE_ENVIRONMENT` and comma-separated `APPLE_ROOT_CERTIFICATE_PATHS` are configured. Missing required certificates/configuration fails startup when enabled. Apple webhook signatures are verified with Apple's server library. Disabled Apple verification must not prevent ordinary subscription-service startup.

## Push delivery setup

The notification service stores pending push deliveries transactionally with their source event. A Firebase Cloud Messaging PushProvider is now included. Enable PUSH_DELIVERY_ENABLED with FIREBASE_PROJECT_ID and valid server Application Default Credentials; enabled push fails startup when required credentials are unavailable. The dispatcher retries failed deliveries with backoff and stops after ten attempts. Provider calls should use the notification ID as their idempotency key because a process can stop after sending but before marking delivery complete. Device tokens are stored in the notification database and must be handled as sensitive data.

## Troubleshooting

| Symptom | Check/action |
|---|---|
| Java 17 selected by the shell | Launcher discovers JDK 21+ and pins JAVA_HOME/PATH for Maven/services. Install JDK 21 if no supported JDK exists. |
| Docker is stopped | On macOS startup opens installed Docker Desktop and waits. Increase `--docker-timeout` if needed. Shutdown never launches Docker. |
| Database does not exist / wrong PostgreSQL | Confirm service JDBC targets `127.0.0.1:15432`; a separate host PostgreSQL on 5432 is not SplitEase's Docker database. |
| Password authentication fails on an old volume | Restore the matching database credentials; environment changes do not reset stored roles/passwords. |
| `relation ... already exists, skipping` during log setup | Normal idempotent schema notices; these do not indicate failure. |
| `A log collector is already running` | Startup now discovers/stops this checkout's orphan collector even without its PID file. Rerun startup with the updated scripts; do not remove a live lock file. |
| Collector exited for another reason | Inspect `logs/log-collector.log`; original service logs remain available for retry. |
| Service exits and all containers stop | Launcher is cleaning up a failed partial startup. Read its printed reason and `logs/<service>.log`. |
| Port 9890–9897 is occupied | Startup terminates listeners as requested, escalating if necessary. Permission errors or an automatically respawning owner can still prevent startup. |
| Gateway predicate cannot be parsed | Identity uses one quoted predicate: `Path=/api/v1/auth/**,/api/v1/users/**`. Commas inside a YAML flow list must not split it into separate predicates. |
| Discovery repeatedly contacts localhost:8761 | Rebuild with the standalone configuration: explicit localhost hostname and self-referencing defaultZone use port 9897. |
| Firebase login returns 503 | Configure Firebase Admin credentials; Android `google-services.json` is not a server credential. |
| Phone cannot connect to the gateway | Confirm startup finished, port 9890 is listening, the LAN IP is current and the phone can reach the Mac. Use `10.0.2.2` for the emulator. |
| App shows SDK codes or configuration details | Rebuild/reinstall the current frontend. Public backend 5xx errors and frontend error banners use generic user-facing copy. |

Read-only diagnostics:

```bash
lsof -nP -iTCP:9890 -sTCP:LISTEN
curl http://localhost:9890/actuator/health
curl http://localhost:9890/api/v1/subscriptions/plans
docker compose ps -a
tail -n 80 logs/log-collector.log
tail -n 80 logs/identity-service.log
```

## Repository layout

| Path | Purpose |
|---|---|
| `start.sh`, `stop.sh`, `dev.sh` | Lifecycle and development commands |
| `scripts/lifecycle.py` | Tool/JDK checks, Docker startup, databases, process management and health checks |
| `scripts/dev_watch.py` | Debounced source monitoring and affected-service reloads |
| `scripts/log_collector.py`, `scripts/log_schema.sql` | Durable application-log ingestion and query schema |
| `scripts/tests/` | Isolated Python tests, without real service/container calls |
| `common/` | Shared API types, exceptions, correlation and request idempotency |
| `*-service/` | Discovery, gateway and six business modules |
| `compose.yml`, `infra/postgres/init/` | Local infrastructure and initial database definitions |
| `.env.example` | Environment-variable template |
| `logs/`, `.runtime/` | Ignored application logs, PID/lock files and collector checkpoints |
| `TASKS.md` | Implementation status and verification notes |

## Verification and limitations

User-provided terminal output and local log inspection have shown successful Maven packaging and several service startups/migration runs during troubleshooting. This does not establish complete end-to-end verification of the latest source. Historical per-change notes are recorded in `TASKS.md`.

Current checks include shell/Python syntax, Java/Kotlin source parsing and formatting, YAML/XML structure, migration version uniqueness, and 26 isolated Python lifecycle/collector/watch tests. Java idempotency and redaction test sources are present. This README update did not rebuild, restart, migrate, or launch either application. Full Java suites, current live reload, logging-database recovery, real Google sign-in, provider integrations and device workflows require runtime verification.

To run the isolated Python tests:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/tests -v
```

Receipt file storage/upload, production email delivery and push delivery need provider adapters. Android Play Billing, advertising and explicit existing-account Google linking are separate integrations. The local lifecycle tooling is not a production supervisor or deployment system.

Before opening Google account selection, Android calls `GET /api/v1/auth/firebase/status` through the gateway with an eight-second overall timeout. It requires `available: true`; network errors, failed routing or unavailable Firebase server configuration keep the chooser closed and show friendly frontend copy. The public status response contains only availability, with generic errors on failure. This checks reachability and local Firebase initialization, not a full external Google sign-in or service-account permission validation.

## Email-based group invitations

The invitation form asks for **Friend's email address**, with email keyboard/validation. Users no longer need to find or share an account UUID. Owners submit:

```http
POST /api/v1/groups/<group-id>/invitations
Authorization: Bearer <backend-access-token>
Idempotency-Key: <new-action-uuid>
Content-Type: application/json

{"email":"friend@example.com"}
```

Email addresses are normalized to lowercase. An owner can create an invitation before the friend has registered. It appears in the recipient's in-app invitation inbox after signing in using that email; an email delivery provider is not wired to this action, so this does not send an email message. Only the authenticated matching email can accept an unbound email invitation; accepting binds the internal user UUID and adds group membership. Existing UUID-based invitations continue to authorize their original user. Owners can revoke invitations, pending duplicates are constrained per group/email, and normal expiration still applies. Owner self-invitations are rejected. Inviting an existing group member may be rejected when they accept; no identity enumeration endpoint is added.

The gateway supplies the authenticated `X-User-Email`; it must remain the public entry point. Apply `group-service` migration `V4__email_invitations.sql` through Flyway. Existing UUIDs remain internal identifiers for authorization, splits and membership. New invitation clients must send `email` rather than `userId`. The Android profile now explains invitation-by-email and does not present a shareable account ID.

## Local resource tuning

The local launcher now starts JVMs with 32 MiB initial heaps, heap caps of 128 MiB for discovery, 192 MiB for gateway and 256 MiB per business service, Serial GC and two visible processors. Gateway Netty I/O workers are limited to two. These are local-workload defaults and are not total process memory limits: metaspace, thread stacks, direct buffers and other native allocations consume additional memory. Eight independent JVMs plus PostgreSQL/Kafka/Redis still have unavoidable baseline cost.

Database pools default to maximum three connections and zero minimum-idle connections per business service, retiring idle connections after 60 seconds. HTTP services use at most 16 Tomcat request threads, one minimum spare thread and 128 connections; discovery also reduces its request thread pool. Hibernate batch fetching uses batches of 32 to reduce repeated collection queries without pagination fetch joins. These defaults prioritize a small local workload and can reduce peak throughput; raise them for a tested higher load.

Kafka's Compose heap defaults to `-Xms64m -Xmx384m`, with two network, I/O and background workers. The source watcher polls once per second with its existing debounce. The database log collector waits up to two seconds between small batches instead of spawning Docker/psql for individual lines; large backlogs continue draining without that pause. API log persistence remains eventual and retry-safe.

Configuration examples (also in `.env.example`):

```dotenv
JAVA_ACTIVE_PROCESSORS=2
DB_POOL_MAX_SIZE=3
DB_POOL_MIN_IDLE=0
HTTP_MAX_THREADS=16
KAFKA_HEAP_OPTS=-Xms64m -Xmx384m
# Optional global heap override:
# JAVA_MAX_HEAP=512m
# Optional full JVM option replacement:
# SPLITEASE_JAVA_OPTS=-Xms64m -Xmx512m -XX:ActiveProcessorCount=2 -XX:+UseG1GC
```

Restart `./dev.sh` once to load changes to the Python watcher/launcher. A full initial restart is needed to recreate Kafka with the new container settings. The Android app also needs rebuilding/reinstalling for the email invitation UI. JDBC/HTTP pool environment changes are mapped to their consuming services by watch mode. Runtime resource savings and throughput have not been benchmarked; JVM heap caps may need adjustment for larger data sets.

Verification for this change: 28 isolated Python tests passed. Four Java invitation tests were added for normalized pre-signup invitations, matching-email acceptance, rejection of another email and preserving user-bound ownership. Java/Kotlin parsing/formatting, XML/YAML, migration uniqueness and source contract checks were performed; Java test execution, migration execution, new JVM startup and end-to-end email acceptance remain unverified. A read-only pre-change snapshot showed Kafka at roughly 667 MiB; no post-change memory reduction is claimed.

Tuning property references: [Spring Boot application properties](https://docs.spring.io/spring-boot/appendix/application-properties/) and [Java launcher options](https://docs.oracle.com/en/java/javase/22/docs/specs/man/java.html).

Google login saves the verified Firebase `picture` URL to `splitease_identity.users.photo_url` (migration `V4__user_profile_photo.sql`) for new and returning users. Login, refresh and `/api/v1/users/me` responses include `user.photoUrl`/`photoUrl`. The URL is refreshed on each Google login; absent/invalid/non-HTTPS URLs become null. The server stores the URL, not an image blob, and never downloads an arbitrary image. Android displays the persisted URL with a cached image loader and a person icon fallback. Existing users obtain a photo on their next Google login. Profile photo fields are redacted in gateway body audits.

The Android client now uses Room to cache account/group data and queue new expenses offline. WorkManager authenticates the same Firebase identity and submits queued expenses through `POST /api/v1/expenses`, reusing the persisted operation UUID as `Idempotency-Key`. No direct mobile access to PostgreSQL is used. Existing backend idempotency handles a retry after an uncertain commit. See the mobile README for offline scope, state handling, account isolation and verification limits.

Group member responses now include `displayName`, resolved in batches from a service-key-protected identity endpoint (`POST /internal/v1/users/profiles`, maximum 200 IDs per batch). The gateway does not expose this internal route. Android uses the name consistently in split selectors, member lists, expense payers and balances; names are included in cached group JSON for offline use after an online refresh. If a profile is unavailable, it shows “Name unavailable” rather than exposing a UUID. Configure `IDENTITY_SERVICE_URL` for non-local groups-to-identity access.

## Invitation and expense activity notifications

Groups publish `invitation.created` through a transactional outbox (group migration `V5__invitation_outbox.sql`). Consumers use the existing processed-event ledger to deduplicate delivery. Existing recipients are resolved through an internal identity endpoint protected by the service key and receive an inbox notification. Before-signup invitations remain in `pending_invitation_alerts` until the authenticated matching email opens its inbox; expired pending alerts are not delivered. A later revocation may leave a historical notification visible, while actual acceptance is still checked by groups-service.

Expense creation notifies the payer and distinct split participants. Expense edits/deletes notify the union of previous/current participants from `expense.changed`; payment receipt notifications remain supported. `NotificationWriter` applies user inbox/push preferences and transactionally queues optional pushes. Notification views now include `groupId`, `invitationId` and `expenseId`. Apply notification migration `V5__activity_notification_targets.sql` through startup.

FirebasePushProvider sends data-only FCM messages using server Admin credentials. Android checks the active Firebase/Room account before displaying them, uses stable notification tags to replace duplicate deliveries, registers/renews tokens with WorkManager and adds an unread Activity badge. Activity taps mark records read and open the group/invitation flow; system notification taps open Activity and refresh it.

Local PUSH_DELIVERY_ENABLED is enabled when Admin credentials are configured. The template remains false for unconfigured installations. Rebuild/restart the backend to apply dependencies and migrations, rebuild/install Android, then enable **Profile → Push notifications** and grant Android permission. Inbox updates work without push. The existing preference model supports one device token per user, so the most recently registered device receives pushes. Firebase Cloud Messaging API/IAM access and real device delivery need separate verification; force-stopped apps do not receive until reopened.

Four Java consumer test sources cover participant fan-out, duplicate events, invitation dispatch and deletion recipients. Source/configuration checks and isolated Python tests were used. No Java build/test run, migration execution, FCM call or device notification test was performed for this change. No notifications were sent during implementation. References: [FCM receiving messages](https://firebase.google.com/docs/cloud-messaging/android/receive-messages), [FCM priority](https://firebase.google.com/docs/cloud-messaging/android-message-priority).

- Group context in notifications: new expense and settlement notification titles include the group name in the persisted inbox and push payload. Invitations already name the group. Group summaries use a protected internal endpoint; transient failures retain event retry behavior. Android Activity also resolves group names for older notifications from saved groups. Previously delivered tray notifications are unchanged. Source formatting checked; no build/run performed.
