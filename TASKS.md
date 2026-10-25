# SplitEase Project Tasks

Last updated: 2026-10-01

## Status workflow

Every implementation task uses one of these states:

- `PLANNED`: accepted work that has not started.
- `IN_PROGRESS`: actively being implemented.
- `BLOCKED`: cannot continue without a decision or external dependency.
- `DONE`: source implementation and permitted static checks are complete.

When work begins, update the task to `IN_PROGRESS`. When its source changes and static checks are complete, update it to `DONE` and add a completion note. Builds and runtime checks remain excluded until explicitly authorized.

## Current milestone: secure core expense workflow

| ID | Priority | Status | Task |
|---|---|---|---|
| TASK-001 | P0 | DONE | Enforce group membership for expense and settlement reads/writes through a private groups-service contract. |
| TASK-002 | P0 | DONE | Replace direct Kafka publishing with a transactional outbox and idempotent consumers. |
| TASK-003 | P0 | DONE | Add verified Google Play and Apple purchase-provider ports, signed webhook handling, and idempotent subscription activation. |
| TASK-004 | P1 | DONE | Build aggregate group balances from expense and settlement events and expose simplified payment suggestions. |
| TASK-005 | P1 | DONE | Add refresh-token rotation, logout/revocation, email verification, and login throttling. |
| TASK-006 | P1 | DONE | Add invitation lifecycle: create, accept, decline, expire, and revoke. |
| TASK-007 | P1 | DONE | Add expense editing, deletion, categories, notes, receipt metadata, and audit history. |
| TASK-008 | P1 | DONE | Add notification preferences, unread counts, pagination, and push-delivery provider ports. |
| TASK-009 | P2 | IN_PROGRESS | Add OpenAPI documentation and consistent pagination contracts. |
| TASK-010 | P2 | PLANNED | Add unit, repository, contract, and Testcontainers test suites. |
| TASK-011 | P2 | PLANNED | Add container images, production Compose wiring, health dependencies, and observability dashboards. |
| TASK-012 | P2 | PLANNED | Add CI checks for formatting, compilation, tests, migrations, dependency review, and container scanning. |

## Completed foundation

| ID | Status | Completed | Result |
|---|---|---|---|
| FOUNDATION-001 | DONE | 2026-09-30 | Created the Java 21 multi-module Maven structure. |
| FOUNDATION-002 | DONE | 2026-09-30 | Added discovery, gateway, identity, groups, expenses, settlements, subscriptions, and notifications services. |
| FOUNDATION-003 | DONE | 2026-09-30 | Added PostgreSQL Flyway schemas, Kafka/Redis configuration, and local infrastructure definitions. |
| FOUNDATION-004 | DONE | 2026-09-30 | Added JWT gateway filtering, BCrypt credentials, expense split rules, server-controlled no-ads plans, and notification events. |

## Activity log

- 2026-09-30: Created this tracker and started `TASK-001`.
- 2026-09-30: Completed `TASK-001`; added a service-key-protected membership contract and enforced it for expense and settlement participants and group-scoped reads.
- 2026-09-30: Started `TASK-002` transactional outbox and consumer idempotency work.
- 2026-09-30: Completed `TASK-002`; expense and settlement changes now use persisted outboxes, and notification consumers deduplicate event IDs transactionally.
- 2026-09-30: Started `TASK-004` balance projection and debt-simplification API work.
- 2026-09-30: Completed `TASK-004`; added idempotent expense/payment projections, atomic PostgreSQL balance updates, authorized balance queries, and simplified payment suggestions.
- 2026-09-30: Started `TASK-003` verified store purchase and webhook lifecycle work.
- 2026-09-30: `TASK-003` progress: added Google subscriptions-v2 verification, Apple JWS transaction verification, Apple Notification V2 processing, provider-bound plans, and idempotent Apple webhook storage. Google RTDN authentication and processing remain unfinished.
- 2026-09-30: Existing foundation inspected with source-only XML, YAML, package-path, brace-balance, and formatting checks.

- 2026-10-01: Completed `TASK-003` source work; added authenticated Google Pub/Sub RTDN processing, package/subscription validation, current purchase re-verification, transactional deduplication, and cross-instance activation locks. Added configuration and setup documentation. Multi-line-item Google subscriptions are rejected pending an entitlement policy; compilation and provider integration remain unverified.
- 2026-10-01: Started `TASK-005` secure identity lifecycle work.
- 2026-10-01: Completed `TASK-005` source work; registration now requires email verification, login issues rotating refresh tokens, replay revokes the token family, logout revokes the family, and persistent login throttles apply across service instances. Existing users are preserved as verified by the migration. Added a local logging sender and a production email-sender port. XML, YAML, package-path, brace, and whitespace checks passed; compilation, migration execution, email delivery, and runtime security behavior remain unverified.
- 2026-10-01: Started `TASK-006` invitation lifecycle work.
- 2026-10-01: Completed `TASK-006` source work; replaced direct member addition with owner-created invitations, invitee acceptance or decline, owner revocation, and lazy expiry. Added a migration, uniqueness guard, and cross-instance locking for invitation changes. Maven XML, YAML, package-path, brace, and whitespace checks passed; compilation, migration execution, and runtime behavior remain unverified.
- 2026-10-01: Started `TASK-007` expense lifecycle and balance correction work.
- 2026-10-01: Completed `TASK-007` source implementation; payer-authorized edits and soft deletion now record audit snapshots and publish revisioned correction events. Settlement balances apply the latest expense snapshot, ignoring older events. Added category, notes, receipt metadata, and schema migrations. Source structure checks passed; compilation and runtime behavior remain unverified. Deployments with existing projected expenses require a one-time balance/projection reconciliation before enabling edits.
- 2026-10-01: Started `TASK-008` notification preferences, pagination, and push delivery work.
- 2026-10-01: Completed `TASK-008` source work; added per-user inbox and push preferences, visible unread counts, bounded pagination, transactional push queueing, provider port, and retrying dispatcher. Push dispatch remains disabled until a provider adapter is supplied. Maven XML, YAML, migration-version, package-path, brace, and whitespace checks passed; compilation and runtime behavior remain unverified.
- 2026-10-01: Started `TASK-009` OpenAPI and pagination contract work.

## Verification boundary

The project has not been built or run. Task completion currently means source implementation plus non-executing structural validation; compilation, migrations, infrastructure connectivity, security behavior, and runtime integration remain unverified.

## Android application integration

- 2026-10-25: DONE (source only): Added Firebase Google token exchange and native Compose application in `/Users/debarunlahiri/AndroidStudioProjects/Splitease`. Retain source-only verification.

- 2026-10-25: Kotlin source parsed/formatted with ktfmt; 22 XML/Maven files parsed; expense participant/date bindings reviewed; backend whitespace checks passed. Android Firebase configuration, HTTPS gateway URL, server credentials, Flyway execution, dependency resolution, builds, device checks, and end-to-end authentication remain pending.

## Local lifecycle scripts

- 2026-10-25: DONE (source and isolated checks): Added start/stop launchers, dependency/configuration checks, project-scoped restart, database creation, Flyway startup migrations, readiness gates and failure cleanup. Five isolated lifecycle tests, Bash/Python syntax, Maven XML, migration version uniqueness and whitespace checks passed. No real backend startup, shutdown, Docker, migration or Maven build was performed.

## Request deduplication

- 2026-10-25: DONE (source only): Added transactional persistent Idempotency-Key protection for 12 authenticated mutations, five service migrations, Android retry keys and six JUnit test cases. Java/Kotlin parsing and formatting, endpoint coverage, XML and migration checks passed. Compilation, JUnit execution, database concurrency and migration execution remain unverified.

- 2026-10-25: Fixed startup selecting Java 17 despite an installed Java 26 JDK. Launcher now discovers JDK 21+, pins JAVA_HOME/PATH for Maven/services, and starts Docker Desktop automatically on macOS when needed. Nine isolated lifecycle tests passed; read-only verification confirmed Maven selects Java 23. Real Docker startup and backend execution remain unverified.

- 2026-10-25: Updated HTTP service ports to 9890–9897: gateway 9890, identity 9891, groups 9892, expenses 9893, settlements 9894, subscriptions 9895, notifications 9896, discovery 9897. Updated internal URLs, readiness probes, launcher and documentation. No live restart performed.

- 2026-10-25: Diagnosed unavailable gateway: Groups startup reached the host PostgreSQL on 5432 instead of the Docker instance and failed with missing `splitease_groups`. Changed Docker PostgreSQL host binding and all JDBC defaults/launcher URLs to `127.0.0.1:15432`. Host PostgreSQL left untouched; no live restart performed.

- 2026-10-25: Fixed subscription startup failure caused by order-sensitive Apple ConditionalOnBean checks. Apple controller, webhook service and purchase verifier now share the existing stores.apple.enabled property condition with Apple configuration. Added terminal startup-failure summaries before/after partial-stack cleanup. Source and isolated checks only; no backend rebuild/restart performed.

- 2026-10-25: Fixed gateway predicate YAML: identity auth/user paths are now a single quoted Path predicate instead of two YAML flow-list entries. Expanded all six routes to readable block lists. Source configuration checks passed; no build/restart performed.

## Detailed application/API logging

- 2026-10-25: DONE (source and isolated checks): Added gateway request/response audits, redaction and downstream request IDs, console streaming, and durable checkpointed collection of eight application log files into splitease_logs. Sixteen isolated Python tests passed; Java parsing/formatting and Python/XML/YAML/whitespace checks passed. Added three Java redaction test cases without executing them. No backend build/restart, logging-database schema execution or end-to-end capture performed.

- 2026-10-25: Diagnosed Firebase 503 configuration gap: project ID is set but server credentials/ADC are absent; supplied google-services.json is Android-only. Added readable ResponseStatusException API envelopes, explicit Firebase server-credential errors, setup instructions and Git ignore for the misplaced Android config. Server credential provision remains external and pending; no restart performed.

- 2026-10-25: User authorized terminating unrelated listeners on backend ports. Startup now clears 9890–9897 using lsof, graceful termination and forced termination when necessary; permission failures are reported.

- 2026-10-25: Removed Firebase configuration instructions from public error responses and made all ResponseStatusException 5xx responses generic. Server-only diagnostics remain in identity logs. Confirmed current Android source already maps failures to user-facing copy; installed app/backend must be rebuilt/restarted to apply source changes.

- 2026-10-25: Fixed standalone discovery peer configuration: explicit localhost hostname and self-referencing defaultZone use server.port (9897), preventing replication attempts to default port 8761. Firebase 503 remains independently blocked by missing Admin credentials. YAML checked; no rebuild/restart performed.

## Development watch mode

- 2026-10-25: DONE (source and isolated checks): Added dev.sh and start.sh --watch, debounced source/resource/POM/environment monitoring, affected-service rebuild/restart, shared-code dependent reloads, development profile, lifecycle locking and concurrent console log streaming. Twenty isolated Python tests and shell/Python syntax checks passed. Live watch/rebuild/restart behavior remains unverified.

- 2026-10-25: Consolidated README setup, commands, ports, seven databases, Firebase, Android HTTP addresses, authenticated API routes, idempotency, logging, dev auto-reload, provider setup, troubleshooting and verification limits. Fixed orphan collector recovery when PID state is missing; collector publishes readiness/PID only after acquiring its lock. Twenty-two isolated Python tests passed; no full backend restart performed.

- 2026-10-25: Refined development reload scope: discovery reloads alone; effective .env key changes map to consuming services; example/comment-only changes are ignored; root service-account changes restart identity/subscriptions without Maven. Only parent/common dependency changes trigger broader necessary reloads. Twenty-six isolated Python tests passed; no live reload performed.

- 2026-10-25: Added public Firebase sign-in availability preflight. Android now checks gateway/identity reachability and Firebase local configuration before opening Google account selection, with an eight-second timeout and existing safe error copy. Source checks only; no app/server build or runtime sign-in performed.

## Email invitations and local resource use

- 2026-10-25: DONE (source and isolated checks): Replaced UUID invitation input with validated email recipients, supporting invitations before signup and preserving legacy UUID invites. Removed Android account-ID instructions. Added bounded local JVM heaps/worker counts, small elastic JDBC pools, lower HTTP worker counts, Hibernate batch fetching, Kafka heap/thread limits and reduced collector/watcher polling. Twenty-eight isolated Python tests passed; four Java invitation tests added without execution. Source syntax/configuration/migration checks passed; no backend/app build/restart, migration execution or resource benchmark performed.

- 2026-10-25: Added verified Firebase profile photo URL persistence for new/returning Google logins, identity migration, API profile field and Android cached avatar display/fallback. Profile refresh loads users/me. Source checks only; no live Google login, build or migration execution performed.

- 2026-10-25: Replaced Android Member-plus-ID labels with real backend display names across all memberName consumers. Added bounded batch internal identity lookup protected by X-Service-Key and group member displayName field; refreshed selected group data uses latest names and cached groups retain names offline. No build/restart performed.

- 2026-10-25: Added invitation transactional events/outbox, pre-signup recipient inbox materialization, expense participant/create/edit/delete notifications, navigation targets, Firebase push delivery and Android permissions/profile switch/token renewal/unread badge. Local push enabled when Admin credentials are configured. Added four Java consumer tests as source; runtime push/build/migration checks remain unverified.
