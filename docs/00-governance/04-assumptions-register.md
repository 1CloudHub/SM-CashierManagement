---
id: GOV-004
title: Assumptions register
version: 0.2.0
status: Draft
owner: TBD
last_updated: 2026-09-30
related: [DOM-001, DOM-003]
---

# Assumptions register

> **Purpose:** Assumptions the plan relies on, who owns confirming them, and their status. Initial entries are carried over from the prototype (v3) documents.

## Register

| ID | Assumption | Source | Owner | Status |
|---|---|---|---|---|
| A-001 | Demand, lane counts and staff availability are simulated, not SM data | Prototype v3 | TBD | Open — replace with real POS/HR data |
| A-002 | October team is a model estimate, not SM's actual headcount | Hiring plan summary | HR | Open |
| A-003 | Lead times: 8 weeks recruiting, 4 weeks offers, 3 weeks training | Hiring plan summary | HR | Open |
| A-004 | Base cashier rate ₱87/hour | Calculator default | Finance/HR | Open — confirm regional wage order |
| A-005 | 2026 holiday list and day-type multipliers | Calculator | HR/Legal | Open — confirm official proclamation and DOLE rules |
| A-006 | 10–15% drop-out buffer on seasonal hires | Report §5 | HR | Open |
| A-007 | Holidays behave as they did in 2025; trading hours copy last year's matching day | Report §9 | Planning | Open |
| A-008 | ~~No cashier sharing across departments or stores~~ — superseded: cross-store sharing is in scope (design v0.3.0) | Report §9 | Operations | Closed |
| A-009 | Shrinkage default ×1.30; service target 90% within 60 s | Calculator defaults | Operations | Open |

| A-010 | Metro Manila store list and positions come from Wikipedia's mall list (approximate coordinates) until SM provides geocoded store master data | Design v0.3.0 | Rules Steward | Open |
| A-011 | Staff home areas in the demo are synthetic, at barangay level | Design v0.3.0 | HR | Open |
| A-012 | Travel times are estimates (car via routing; public transport via speed factor) | Design v0.3.0 | Planning | Open |

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1.0 | 2026-09-30 | TBD | Initial scaffold with prototype assumptions |
| 0.2.0 | 2026-09-30 | Kiro | Cross-store sharing in scope; map assumptions A-010–A-012 |
