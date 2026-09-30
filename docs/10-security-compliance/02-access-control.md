---
id: SEC-002
title: Access control
version: 0.2.0
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

TODO

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
  the SPA stays locked on passkey registration. Requires a verified Amazon SES
  identity; until one is configured, email OTP is off.
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
