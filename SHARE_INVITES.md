# Shareable group invitations

The group owner can open People → Invite a friend → Share invite link and use
Android's share sheet to send the link through WhatsApp or another app. Email
invitations remain available.

The recipient opens the web link and taps **Open SplitEase**. The app saves the
invite locally before restoring the session. Existing users join immediately;
new users sign in with Google, which creates their backend account through the
existing Firebase exchange, and then join the group. Successful joining opens
the group. Interrupted network requests retain the invite for retry on the next
successful operation. Invalid or expired invites are cleared with an explanation.

Links work for multiple recipients for seven days. Reopening a valid link never
adds a duplicate member. Anyone holding a valid link can join. Only group owners
can create links, and joining requires authentication. The server stores SHA-256
hashes of random 256-bit tokens. Joining uses the same per-group transaction lock
as email invitations. Group member rows are the authoritative People list.

While a group screen is visible, membership refreshes every 15 seconds and when
returning to the screen. Opening or refreshing a group fetches current membership.
Background membership refreshes keep existing data on a network failure.

## API

All `/api/v1/groups` endpoints below require the existing gateway bearer token;
identity headers are supplied by the gateway, not trusted from the caller.

- `POST /api/v1/groups/{groupId}/invite-links`: owner only; returns
  `{ "token": "...", "expiresAt": "..." }` with HTTP 201.
- `POST /api/v1/groups/invite-links/join`: body `{ "token": "..." }`;
  returns `{ "groupId": "..." }`. Unknown links return 404, expired links 409.
  Repeated joins return the same group ID without duplicating membership.
- `GET /api/v1/groups/{groupId}`: current members only; returns the group and
  member display names using the existing group view contract.
- `GET /join`: public gateway HTML landing page. The token is a URL fragment
  (`/join#TOKEN`), so it is not sent in landing-page HTTP requests or server logs.
  The button opens `splitease://join?token=TOKEN`; only opening the app joins.

## Deployment and verification

Deploy the updated gateway and group service, including Flyway migration
`V6__group_invite_links.sql`, and install an updated Android app. The configured
Android API base URL must be reachable by recipients; the same origin must serve
`/join` through the gateway. A localhost/emulator-only address is not shareable
between devices. Use the public gateway HTTPS address in production.

This implements an explicit web-to-app button, not verified Android App Links or
an install-referrer service. If SplitEase is not installed, the recipient must
install it and reopen the original invitation link. No invite is automatically
carried through an app-store installation.

Added backend tests cover owner-only creation, token shape/expiry, multiple
recipients, duplicate joins, unknown links, and expired links. Source formatting,
XML parsing, and Git whitespace checks are the validation performed here.
Compilation, tests, Flyway execution, browser handoff, sharing, sign-in, and
multi-device updates still require an authorized build/runtime verification.
