# SplitEase Architecture

## Service boundaries

The gateway validates access tokens and replaces caller-supplied identity headers with trusted JWT claims. Business services never share database tables: identity owns accounts, groups owns membership, expenses owns expense shares, settlements owns recorded payments, subscriptions owns plans and entitlements, and notifications owns inbox records.

## Expense rules

- Amounts use decimal arithmetic with a scale of two.
- Exact split values must total the expense amount.
- Percentage values must total 100; the final participant receives any rounding remainder.
- Equal splits allocate the rounding remainder deterministically to the first participant.
- Duplicate participants and self-payments are rejected.

The groups service owns membership data and exposes a private membership snapshot contract protected by an internal service key. Expense creation verifies the payer and every participant, settlement creation verifies both parties, and group-scoped reads verify the caller. The expense and settlement services use this contract instead of reading the groups database.

## Ads and paid entitlement

The free entitlement returns `adsEnabled: true`. An active plan that removes ads returns `adsEnabled: false` until its server-side expiry. Plan identity, amount, currency, duration, and feature flags live in the subscription database so clients do not hard-code commercial terms.

Purchase confirmation is delegated to provider-specific verification ports. Google Play confirmation calls the Android Publisher subscriptions v2 API with server credentials, validates the product and user binding, and stores only a hash of the purchase token. Apple confirmation verifies StoreKit JWS transactions using Apple's server library and configured root certificates. Apple Notification V2 payloads are signature-verified and deduplicated before they activate, renew, expire, or revoke an entitlement. Client purchase success by itself never grants the entitlement.

## Consistency and messaging

Expense and settlement transactions persist domain events to local outbox tables. Scheduled publishers deliver pending JSON events to Kafka with at-least-once semantics, and notification consumers persist processed event IDs in the same transaction as inbox records so redelivery does not create duplicates.

The settlement service also consumes expense and settlement events into a per-group, per-user, per-currency balance projection. PostgreSQL upserts apply balance deltas atomically, processed event IDs prevent double application, and the query layer converts the resulting debtors and creditors into a reduced set of suggested payments.

## Security checklist

- Expose business services only on a private network; expose the gateway publicly.
- Replace all example secrets and rotate signing keys through a managed secret store.
- Add refresh-token rotation, revocation, login throttling, and verified email ownership.
- Replace the initial shared service key with workload identities or mutually authenticated TLS.
- Verify payment-provider signatures and make webhook processing idempotent.
- Restrict actuator endpoints and configure explicit CORS origins.
