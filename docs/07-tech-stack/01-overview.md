---
id: TS-001
title: Tech stack
version: 0.2.0
status: Draft
owner: TBD
last_updated: 2026-09-30
related: [ADR-0002, DEP-003, DEP-004, TS-002]
---

# Tech stack

> **Purpose:** Summarises the application stack. The decision and alternatives are recorded in ADR-0002.

## Architecture summary

React + TypeScript SPA calling a Node.js + TypeScript JSON API, on AWS. Amazon Cognito for passkey auth, PostgreSQL for relational data, S3 for files, a queue + workers for background jobs, Amazon Location Service for maps/routing, Amazon SES for email. Provisioned with AWS CDK.

## Frontend

- React + TypeScript, Vite.
- Accessible component library (WCAG 2.2 AA), themeable with SM brand tokens (SG-004).
- i18n via resource bundles (en, fil); all strings, dates, numbers and ₱ formatting externalised (UX-011, spec Req 23).
- Client owns visual planning (Day timeline, Week grid, Month), filters and URL state (spec Req 6, 21).

## Backend

- Node.js + TypeScript HTTP API.
- Server-side authorization against the active role and scope on every request (spec Req 2, Property 12).
- Domain layer (forecast, Erlang C, shrinkage, shift build, roster, hiring, cost) is pure TypeScript, unit- and property-tested (TS-002).

## Database

- PostgreSQL (Amazon RDS/Aurora). Entities per DOM-002 data dictionary; append-only audit table.

## Storage

- Amazon S3 for uploaded ingestion files and generated PDF leadership summaries.

## Compute and background jobs

- API on containers or Lambda; hiring plan and >4-week rosters run as queued background jobs (SQS + workers), resumable and idempotent, results cached per scenario version (spec Req 10.2, NFR-REL-001/002).

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1.0 | 2026-09-30 | TBD | Initial scaffold |
| 0.2.0 | 2026-09-30 | Kiro | Summarised the stack chosen in ADR-0002 |
