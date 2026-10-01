---
id: SEC-001
title: Data privacy (RA 10173)
version: 0.2.0
status: Draft
owner: TBD
last_updated: 2026-09-30
related: [SEC-002, SEC-003, DOM-002]
---

# Data privacy (RA 10173)

> **Purpose:** Decides how LaneWise collects, uses, keeps and deletes personal data under the Philippine Data Privacy Act of 2012 (RA 10173). Version 0.2.0 covers staff home areas and their consent (spec requirement 12, property P15); the other data sets are still to be written up.

## Personal data inventory

| Data | Where | Granularity | Who sees it |
|---|---|---|---|
| Staff home area | `staff_home_area` (barangay code, max travel minutes, cross-store offers switch) | Barangay only (PSGC code, name, city). No address, street, coordinates or live location is collected or stored; the only coordinates near a person are the barangay's public centroid in the `barangay` reference list, which no person-linked API response returns. | The staff member; their own store's manager and HR (SCR-053); travel-based matching (task 16). Managers of other stores see staff ID, home store and barangay, and the name only after an offer is accepted (Req 12.5). Planners see counts per barangay only. |
| Home-area consent record | `staff_consent` (purpose, consent-text version and language, granted/withdrawn times and reason) | No location | The staff member (consent history on SCR-080); audit. |
| Consent text | `consent_text` (versioned, immutable, en/fil) | Not personal data | Everyone asked to consent. |

Audit events for home-area changes record only the travel limit, the cross-store switch and whether a home area is shared — never the barangay — because the audit log is immutable and kept for 5 years while the staff member may withdraw at any time.

## Lawful basis

- **Home area:** opt-in consent (RA 10173 s. 12(a)). The staff member reads the current consent text in English or Filipino, ticks that they have read it and agrees; the grant is stored with the text version, language, time and user.
- Consent is specific to one purpose (`home_area`: travel-based matching and the network map). It is never pre-ticked and nothing else depends on it.
- A new consent-text version marked as requiring re-consent makes earlier grants stop counting from its effective date: the staff member leaves the map and matching until they agree to the new text (their home area is kept for when they do).

## Retention

| Data | Kept | Deleted |
|---|---|---|
| Staff home area | Only while an active, current consent exists | Immediately, in the same transaction, when consent is withdrawn or the staff record is deactivated (database trigger). The staff member can also remove it while keeping their consent. |
| Consent record | While the staff record exists, and for 5 years after withdrawal as proof of consent (matching the audit retention, Q13) | By the retention purge (`purgeExpiredConsentRecords`, audited) after 5 years; at once if the staff record is deleted. |
| Audit events | 5 years (SEC-003) | By the opt-in audit retention purge. They hold no barangay. |

## Data subject rights

- **Withdraw consent:** "Stop sharing my home area" on SCR-080 (`DELETE /me/consents/home_area`). Effect is immediate: the home area is deleted and the person no longer appears on the map, in matching or in the manager/HR view.
- **Access:** the staff member sees their home area, consent status and consent history on SCR-080 (`GET /me/home-area`, `GET /me/consents`).
- **Rectification:** the staff member changes their barangay, travel limit and cross-store switch at any time (`PUT /me/home-area`).
- **Erasure:** withdrawal erases the home area; consent records follow the retention rule above.
- Only the staff member can grant, change or withdraw their own consent and home area (RBAC: "Share home area and travel limit (consent)" — Staff, own record only).
- The API enforces this with the task 8.1 guards: the `/me` routes act only on the caller's own staff record (the Staff self scope), and `GET /staff/:staffId/home-area` requires the RBAC row "Staff home area: barangay only (SCR-053)" — Store Manager for their own store, HR — with the same 404 for staff outside scope as for unknown staff.

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.2.0 | 2026-09-30 | Claude (task 15) | Staff home area and consent: inventory, lawful basis, retention and data subject rights |
| 0.1.0 | 2026-09-30 | TBD | Initial scaffold |
