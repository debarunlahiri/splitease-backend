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
| TASK-007 | P1 | PLANNED | Add expense editing, deletion, categories, notes, receipt metadata, and audit history. |
| TASK-008 | P1 | PLANNED | Add notification preferences, unread counts, pagination, and push-delivery provider ports. |
| TASK-009 | P2 | PLANNED | Add OpenAPI documentation and consistent pagination contracts. |
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

## Verification boundary

The project has not been built or run. Task completion currently means source implementation plus non-executing structural validation; compilation, migrations, infrastructure connectivity, security behavior, and runtime integration remain unverified.
