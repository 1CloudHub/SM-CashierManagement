---
id: DOM-003
title: Business rules configuration
version: 0.2.0
status: Draft
owner: TBD
last_updated: 2026-10-01
related: []
---

# Business rules configuration

> **Purpose:** TODO — one or two sentences on what this document decides.

## PH labor rules

TODO

## Premium pay multipliers

TODO

## Holiday calendar

TODO

## Wage orders

TODO

## Planning lead times

TODO

## Rule versioning and ownership

Business rules are kept as **rule sets**, each a series of immutable, effective-dated **versions** (spec Requirement 16; Properties 6 and 7). Implemented in task 10.

| Rule set | Type key | Cost rule | Engine shape |
|---|---|---|---|
| Holiday calendar | `holidays` | No | dated special / regular holidays |
| Wage rates | `wages` | Yes | base ₱/h by region, default rate, employer loading |
| Premium pay multipliers | `premiums` | Yes | day-type multipliers, night differential, overtime |
| Planning lead times | `lead_times` | No | lead times, contract hours, recruiting buffer, milestones |
| PH labor rules | `labor` | No | consecutive days, mandatory rest, weekly hours |
| Service levels | `service_levels` | No | service target, shrinkage, shift rules |
| Transport allowance | `transport_allowance` | Yes | flat ₱ by travel-time band (Q23) |

- **Ownership.** The Rules Steward creates and edits drafts. Finance approves cost rules. Everyone else in the rules RBAC row views them.
- **Lifecycle.** Draft → Submitted → (cost rules) Finance approves, or requests changes with a required comment → Published → Superseded. Non-cost rules skip Finance and are published directly by the Rules Steward. A rule set has at most one open version at a time.
- **Freezing.** A version's values, effective date and change note are frozen once it is submitted. Every submitted version is kept for history.
- **Effective dates.** Each version carries an effective-from date. A newly published version can't take effect before the version it replaces.
- **Results.** Scenario runs record the exact rule versions they used, so publishing a new version never changes existing results.
- **Publishing.** Scenarios pinned to an earlier version are flagged stale, and their owners, planners, Finance and HR are notified.
- **Audit.** Every create, edit, submit, decision and publish writes exactly one audit event.
- **Validation.** Rule values are validated against the shapes the staffing engine consumes (`@lanewise/shared` `validateRulePayload`) in the API and the SPA.

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1.0 | 2026-09-30 | TBD | Initial scaffold |
| 0.2.0 | 2026-10-01 | TBD | Rule versioning and ownership (task 10) |
