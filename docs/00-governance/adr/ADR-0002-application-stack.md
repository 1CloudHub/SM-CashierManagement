---
id: ADR-0002
title: Application technology stack
version: 1.0.0
status: Accepted
owner: TBD
last_updated: 2026-09-30
related: [TS-001, DEP-003, DEP-004]
---

# Application technology stack

> **Purpose:** Records the frontend, backend, data and AWS runtime choices for the Cashier Staffing Planner build.

## Context

The spec requires passkey auth (Amazon Cognito), transactional email (Amazon SES), maps and travel-time routing (Amazon Location Service), background jobs for the hiring plan and long rosters, versioned relational data (scenarios, rules, rosters, audit), file upload ingestion, English/Filipino i18n, and WCAG 2.2 AA. AWS is the target platform with CDK for IaC. The application framework was open.

## Decision

- **Frontend:** React + TypeScript single-page app; Vite build; a component library that supports WCAG 2.2 AA and theming (SM brand tokens per SG-004). i18n via a resource-bundle library (en, fil).
- **Backend:** Node.js + TypeScript HTTP API (REST/JSON). Server-side authorization on every request against the active role and scope.
- **Auth:** Amazon Cognito user pool, passkey (WebAuthn) sign-in, pre-sign-up Lambda enforcing the domain allowlist.
- **Relational store:** PostgreSQL (Amazon RDS/Aurora) for users, roles, scenarios, rule versions, rosters, overrides, requests, offers, transfers, notifications and the immutable audit log.
- **Object storage:** Amazon S3 for uploaded ingestion files and generated PDF summaries.
- **Background jobs:** a queue + worker (SQS + container/Lambda workers) for hiring plans and >4-week rosters; resumable and idempotent, results cached per scenario version.
- **Maps/routing:** Amazon Location Service (maps, places, car route matrix).
- **Email:** Amazon SES, sent per event.
- **IaC/hosting:** AWS CDK (TypeScript); see DEP-003/DEP-004.

## Alternatives considered

- **Server-rendered framework (Next.js/Remix):** viable, but a SPA + separate API keeps the read-only-on-mobile and heavy client-side visual planning (timeline/grid) simpler to reason about. Revisit if SEO or first-load becomes a concern (internal tool, so low priority).
- **Serverless-only backend (API Gateway + Lambda):** kept as an option for the API tier; the decision above allows either containers or Lambda for workers.
- **DynamoDB:** rejected as the primary store because the domain is relational and reporting/audit queries favour SQL.

## Consequences

- Property-based tests (TS-002) run against the TypeScript domain layer for the 19 correctness properties.
- The frontend owns significant logic (visual planning, filters, URL state); accessibility and i18n must be validated in the client.
- AWS coupling is intentional and matches the deployment docs.

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-09-30 | Kiro | Initial stack decision |
