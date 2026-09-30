---
id: NFR-001
title: Non-functional requirements
version: 0.2.0
status: Draft
owner: TBD
last_updated: 2026-09-30
related: [TS-001, TS-002, DEP-003, OPS-001, SEC-001, SEC-002, SEC-003]
---

# Non-functional requirements

> **Purpose:** Defines measurable quality targets for the Cashier Staffing Planner. The spec's `requirements.md` NFR summary references the NFR IDs below. Targets are initial and marked (assumption) where not yet confirmed.

## Performance

| ID | Target |
|---|---|
| NFR-PERF-001 | Interactive screens (network view, department day plan, roster up to 4 weeks) render p95 ≤ 2.0 s on a warm cache over office broadband (assumption). |
| NFR-PERF-002 | Server API responses for read queries p95 ≤ 500 ms within a single store's scope (assumption). |
| NFR-PERF-003 | The hiring plan and rosters longer than 4 weeks run as background jobs; the user sees progress within 1 s and may leave the page. |
| NFR-PERF-004 | Background full-network hiring plan completes p95 ≤ 60 s for the demo network of 27 stores (assumption; revisit at production scale). |
| NFR-PERF-005 | Global search returns grouped results p95 ≤ 800 ms. |

## Scalability

| ID | Target |
|---|---|
| NFR-SCALE-001 | Support the full production store network without redesign; demo runs 27 Metro Manila stores. |
| NFR-SCALE-002 | Background jobs scale horizontally; job throughput degrades gracefully, not with errors, under load. |

## Availability

| ID | Target |
|---|---|
| NFR-AVAIL-001 | 99.5% monthly availability for the application during business hours Asia/Manila (assumption). |
| NFR-AVAIL-002 | Planned maintenance occurs outside 06:00–22:00 Asia/Manila with prior notice. |

## Reliability

| ID | Target |
|---|---|
| NFR-REL-001 | Background jobs are resumable and idempotent; a failed job never leaves partial results marked complete. |
| NFR-REL-002 | Results are cached per scenario version; re-running an unchanged scenario returns identical outputs. |
| NFR-REL-003 | No committed data loss on a single-AZ failure (backed by the backup/recovery policy, OPS-003). |

## Security

| ID | Target |
|---|---|
| NFR-SEC-001 | Passkey-only authentication via Amazon Cognito; no password path (spec Req 1). |
| NFR-SEC-002 | Email-domain allowlist (smretail.com, 1cloudhub.com) enforced server-side at sign-up (spec Req 1, Property 13). |
| NFR-SEC-003 | Authorization enforced server-side against the active role and scope on every request (spec Req 2, Property 12). |
| NFR-SEC-004 | Data encrypted in transit (TLS 1.2+) and at rest. |
| NFR-SEC-005 | Idle session timeout 60 minutes with a 2-minute warning (spec Req 1.8). |

## Privacy

| ID | Target |
|---|---|
| NFR-PRIV-001 | Staff home-area data stored at barangay granularity only; no exact address or live GPS (spec Req 12, Property 15; policy SEC-001, RA 10173). |
| NFR-PRIV-002 | Home-area use requires opt-in consent; withdrawal removes the person from matching immediately. |
| NFR-PRIV-003 | Cross-store candidates shown as ID/home store/barangay until an offer is accepted. |

## Usability

| ID | Target |
|---|---|
| NFR-USE-001 | Every screen works on phone, tablet, laptop and desktop breakpoints (spec Req 24). |
| NFR-USE-002 | On phones, screens are read-only except the approved quick-action set (spec Req 24.2). |

## Accessibility

| ID | Target |
|---|---|
| NFR-A11Y-001 | Target WCAG 2.2 AA; charts have table alternatives, status uses text plus colour, roster grids use table semantics (spec Req 24.4; policy UX-001). |
| NFR-A11Y-002 | Full conformance requires manual testing with assistive technologies before an accessibility claim is made. |

## Localization

| ID | Target |
|---|---|
| NFR-L10N-001 | UI available in English and Filipino; all user-facing strings, dates, numbers and ₱ formatting externalised (spec Req 23; policy UX-011). |
| NFR-L10N-002 | Emails and push notifications sent in the recipient's language preference. |

## Maintainability

| ID | Target |
|---|---|
| NFR-MAINT-001 | The 19 correctness properties are covered by automated tests (property-based where applicable) per the testing strategy (TS-002). |
| NFR-MAINT-002 | Rule sets, wage bands and travel bands are configuration (DOM-003), not code. |

## Compliance

| ID | Target |
|---|---|
| NFR-COMP-001 | PH Labor Code limits enforced in rostering (consecutive days, weekly hours, rest ≥ 10 h, 24-hour rest after 6 days) — hard-blocked where required (spec Req 7.4). |
| NFR-COMP-002 | RA 10173 (Data Privacy Act) for staff personal data (SEC-001). |
| NFR-COMP-003 | Audit events retained 5 years; ingestion files 1 year (spec Req 22.3). |

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1.0 | 2026-09-30 | TBD | Initial scaffold |
| 0.2.0 | 2026-09-30 | Kiro | Filled measurable targets with NFR IDs; linked to spec requirements and properties |
