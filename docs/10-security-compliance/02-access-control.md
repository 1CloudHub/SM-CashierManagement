---
id: SEC-002
title: Access control
version: 0.5.0
status: Draft
owner: TBD
last_updated: 2026-10-01
related: []
---

# Access control

> **Purpose:** TODO — one or two sentences on what this document decides.

## Roles

TODO

## Permission matrix

Implemented in task 8.1 (`packages/shared/src/rbac.ts`, `api/src/auth/`); requirements 2
and 3, properties P1, P11, P12. The matrix itself is design.md › RBAC matrix.

- **Matrix as data:** `RBAC_MATRIX` holds one resource per capability row and the
  V/E/A/X/M cells per role, with cell qualifiers ("own store", "published only") as
  `limit`. A test parses the design.md table and fails on any drift. Every granted
  action implies view; manage implies edit. The SPA hides nav from the same data.
- **Guards on every route:** each route declares `publicRoute()` (only `GET /health`),
  `authenticated()` (caller's own record only: `/me`) or `authorize(resource, action,
  scopeTarget?)`. The app refuses to start if a route declares none.
- **Principal per request:** the user is matched by the verified email claim; role
  assignments are read from the database on every request. The active role comes from
  the `X-Active-Role` header, which may name only a selectable role: any of the 8 in
  demo mode (`DEMO_ROLE_SWITCHER`, on in the demo deployment), otherwise an assigned
  role. Anything else is 403. No other client-supplied identity is read.
- **Scope:** global, region(s), store(s) or self. An assigned role uses its
  assignment's scope; a demo role uses the demo scope (Store Manager = the demo QC
  store, Staff = demo cashier PT-02, others global). List endpoints filter in SQL and
  re-check in code. A deep link to an object that is out of scope, missing or
  malformed returns the identical 404 ("This item doesn't exist or you don't have
  access to it."), so existence is never revealed. Self scope sees no store-wide data.
- **No writes while authorising:** denials (401/403/404) change nothing. Switching the
  active role is an explicit `PUT /me/active-role` that writes exactly one audit event
  with the user and the new role (a demo user's first choice provisions the account in
  the same single `user.created` event).

## Cost visibility

Implemented in task 21 (`packages/shared/src/cost.ts`, `api/src/http/cost.ts`,
`frontend/src/features/cost`); requirement 25, properties P1 and P11.

- **Policy (one, shared):** ₱ figures are reported at four levels — network, store,
  department and individual (one cashier). EXE, PLN, HR and FIN see every level within
  their scope; network cost needs a global or region scope, and a region-scoped role's
  network figure is the total over its own regions only. A Store Manager sees store,
  department and individual cost for their own store(s) only and never network cost.
  Staff never see any cost, not even for their own shifts; ADM and RST have none.
  `costLevelsFor(role)` and `canSeeCost(viewer, target)` hold the rule; `GET /me`
  reports the active role's `costLevels`.
- **Removed on the server, not hidden in the UI:** handlers build every ₱ field with
  `costFigure(target, value)`, where the target names the level and, below network,
  the store the cost belongs to. The router passes every response through
  `shapeCost` with the request's active role and scope, which keeps a permitted
  figure as its number and deletes any other field outright. A raw number under a
  key containing "cost" fails the request (500) instead of leaking, and a figure
  that skipped shaping serialises to nothing.
- **New endpoints and screens must:** tag each ₱ field with `costFigure` (as an
  object property, never a bare array element), declare it optional in the shared
  DTO, and compute network figures from in-scope stores only. The SPA renders every
  ₱ figure with `<CostValue value level>` (the shared Currency component, or a
  "Hidden for your role" state with text and icon), and hides cost-only columns or
  cards with `useCanSeeCost(level)`. The mock API applies the same `shapeCost`.
- **Tests:** property tests over every role and scope assert that each cost field is
  present iff permitted, that Staff responses carry no cost at all (P11), and that
  every route in the app's route table obeys the policy.

## Authentication

Implemented in task 7 (`infra/lib/auth-stack.ts`, `api/src/triggers/pre-sign-up.ts`,
`frontend/src/features/auth`); requirement 1, property P13.

- **Identity provider:** one Amazon Cognito user pool (Essentials tier), email as a
  case-insensitive, immutable username.
- **Passkey-only sign-in:** the SPA app client allows only `ALLOW_USER_AUTH` (choice-based
  sign-in) and refresh; the SPA always requests the `WEB_AUTHN` challenge and never
  continues into another factor. User verification is required. Cognito requires
  `PASSWORD` to remain an allowed first factor, so users are created without a
  password, forgot-password recovery is disabled and the password policy is at its
  maximum. Residual risk: a signed-in user could set a password on their own account
  through the Cognito API; revisit when Cognito allows a pool without `PASSWORD`.
- **Email one-time code:** only bootstraps or recovers a passkey. After a code sign-in
  the SPA stays locked on passkey registration. Sent through Amazon SES (us-east-1)
  as `LaneWise <noreply@1cloudhub.com>` from the verified `1cloudhub.com` domain
  identity; without an SES sender configured, email OTP is off.
- **Relying party / origin:** passkeys are bound to `lanewise.prototypes.1cloudhub.com`
  (the SPA's custom domain), so passkey sign-in works only there. API CORS allows only
  the SPA's origins (custom domain and CloudFront domain).
- **Domain allowlist (P13):** `smretail.com` and `1cloudhub.com`, exact and
  case-insensitive (no subdomains, suffix tricks or look-alike characters). Enforced by
  the pre-sign-up trigger on every creation path (self sign-up, admin create,
  federated) and again by the API on every request's verified claims.
- **Self sign-up:** on in demo mode (Q15); otherwise the trigger also refuses it.
- **Sessions:** 60-minute idle timeout with a 2-minute "Stay signed in" warning and
  return to the same URL. ID/access tokens last 60 minutes, the refresh token 12 hours
  (absolute cap) and is revoked on sign-out and idle timeout.
- **API:** every route except `GET /health` requires a Cognito ID token (API Gateway
  Cognito authorizer); identity comes only from the verified claims.

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1.0 | 2026-09-30 | TBD | Initial scaffold |
| 0.2.0 | 2026-10-01 | Claude | Authentication section (task 7: Cognito passkeys, domain allowlist, sessions) |
| 0.3.0 | 2026-10-01 | Claude | Permission matrix section (task 8.1: RBAC as data, route guards, active role, scope, no-leak 404) |
| 0.4.0 | 2026-10-01 | Claude | SES sender for email one-time codes, custom-domain relying party, CORS allowlist |
| 0.5.0 | 2026-10-01 | Claude | Cost visibility section (task 21: shared policy, server-side removal, CostValue) |
