# SplitEase Backend

SplitEase is a Java 21 and Spring Boot microservice backend for roommates and travel groups to share expenses, calculate balances, record settlements, and manage an optional paid no-ads entitlement.

## Services

| Service | Port | Responsibility |
|---|---:|---|
| Discovery | 8761 | Eureka service registry |
| API Gateway | 8080 | JWT verification, routing, identity forwarding |
| Identity | 8081 | Registration, login, access tokens, user profiles |
| Groups | 8082 | Groups, membership, invitations |
| Expenses | 8083 | Expenses and exact/equal/percentage splits |
| Settlements | 8084 | Balances, simplified debts, payment records |
| Subscriptions | 8085 | Server-controlled plans and no-ads entitlements |
| Notifications | 8086 | Kafka-backed notification inbox |

Each business service owns a separate PostgreSQL database. Kafka carries domain events, Redis stores short-lived entitlement data, and the gateway is the only public entry point.

## Main API routes

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/verify-email`
- `POST /api/v1/auth/resend-verification`
- `GET /api/v1/users/me`
- `POST /api/v1/groups`
- `POST /api/v1/groups/{groupId}/invitations`
- `GET /api/v1/groups/{groupId}/invitations`
- `GET /api/v1/groups/invitations/me`
- `POST /api/v1/groups/invitations/{invitationId}/accept`
- `POST /api/v1/groups/invitations/{invitationId}/decline`
- `POST /api/v1/groups/invitations/{invitationId}/revoke`
- `POST /api/v1/expenses`
- `GET /api/v1/expenses/group/{groupId}`
- `GET /api/v1/settlements/group/{groupId}`
- `GET /api/v1/settlements/group/{groupId}/balances?currency=INR`
- `GET /api/v1/settlements/group/{groupId}/suggestions?currency=INR`
- `POST /api/v1/settlements`
- `GET /api/v1/subscriptions/plans`
- `GET /api/v1/subscriptions/me/entitlement`
- `POST /api/v1/subscriptions/me/purchases/verify`
- `POST /api/v1/subscriptions/webhooks/apple`
- `POST /api/v1/subscriptions/webhooks/google`

## Configuration

Copy `.env.example` to `.env` and replace all example secrets. Runtime values are environment-driven; credentials are not committed. Database schemas are versioned under each service's `db/migration` directory.

## Architecture notes

- Money uses `BigDecimal` and ISO 4217 currency codes.
- Expense creation validates that shares add up exactly to the expense total.
- Registration sends an email verification token and does not create a session. Login requires a verified email.
- Successful login returns a short-lived access token and a rotating refresh token. Refresh token reuse revokes its full token family, and logout revokes that family.
- Logout does not invalidate an already issued access token; it remains usable until its one-hour expiry.
- Login failures are throttled in PostgreSQL so limits apply across identity-service instances. The stored subject is a SHA-256 email hash.
- Inter-service ownership checks are explicit HTTP client boundaries rather than shared database access.
- Expense and settlement reads and writes authorize participants through the groups service.
- Group owners invite a user ID; the invitee must accept before joining. Invitations can be declined, revoked by the owner, or expire after seven days.
- Invitation lifetime is configured with `GROUP_INVITATION_LIFETIME`. Expired invitations are marked when read or acted on; the invitee ID currently follows the existing group API contract and is not looked up in the identity service.
- Subscription prices and features are stored server-side. A mobile client should use the returned entitlement to decide whether ads are allowed.
- Google Play verification calls the Android Publisher subscriptions v2 API using Application Default Credentials.
- Google RTDN checks signed Pub/Sub tokens, the configured audience, verified service account email, subscription name, and app package, then re-fetches the purchase from Google Play.
- Store notification deduplication and subscription changes commit together; PostgreSQL transaction locks serialize duplicate deliveries and activation for the same store reference.
- Apple verification uses Apple's server library to validate signed transactions and Notification V2 payloads against configured Apple root certificates.
- Actuator health and Prometheus endpoints are exposed for operational visibility.

## Execution boundary

This scaffold was created and inspected as source only. It was not built, run, installed, migrated, or connected to infrastructure.

## Google Play notification setup

Enable `GOOGLE_PLAY_VERIFICATION_ENABLED` only after configuring Android Publisher credentials and authenticated Pub/Sub push. Set `GOOGLE_PLAY_PUSH_AUDIENCE` to the exact audience configured on the push subscription, `GOOGLE_PLAY_PUSH_SERVICE_ACCOUNT_EMAIL` to its authentication service account, and `GOOGLE_PLAY_PUSH_SUBSCRIPTION` to its full resource name. Configure wrapped JSON delivery to `/api/v1/subscriptions/webhooks/google`. Missing push configuration fails startup when Google verification is enabled.

Subscription and voided-purchase notifications trigger a current subscriptions-v2 lookup; test notifications are acknowledged without activation. The mobile purchase must bind its obfuscated external account ID to the SplitEase user UUID. Product IDs must map to an active server plan. This adapter currently accepts one subscription line item; multi-item subscriptions need a separate entitlement policy. Tokens are hashed for persisted references and are not saved as raw purchase credentials. A successful notification returns HTTP 204 after its database transaction completes; failures allow Pub/Sub redelivery.

Provider references: [Pub/Sub push authentication](https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions) and [Google Play RTDN](https://developer.android.com/google/play/billing/rtdn-reference).

## Identity security setup

The included email verification sender logs tokens for local development. Set `EMAIL_VERIFICATION_LOGGING_ENABLED=false` in deployed environments and provide an `EmailVerificationSender` adapter that delivers the token through the chosen email provider. The service intentionally fails to start if verification logging is disabled without another sender.

Refresh and verification tokens are generated from secure random bytes. Only their SHA-256 hashes are stored. Login throttling defaults to five failures within 15 minutes followed by a 15-minute block; the durations and threshold are environment configurable.
