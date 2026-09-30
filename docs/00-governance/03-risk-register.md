---
id: GOV-003
title: Risk register
version: 0.2.0
status: Draft
owner: TBD
last_updated: 2026-09-30
related: [SG-004, ADR-0003, GOV-004, GOV-005]
---

# Risk register

> **Purpose:** Tracks project risks with likelihood, impact and mitigation.

## Scoring method

Likelihood × Impact, each Low/Medium/High. Priority = the higher of the two unless both are High (then Critical).

## Register

| ID | Risk | Likelihood | Impact | Priority | Mitigation |
|---|---|---|---|---|---|
| R-001 | LaneWise primary blue (#1d4ed8) differs from SM's signature navy; SM brand team may reject or change it | Medium | Medium | Medium | Tokens (`--lw-*`) are swappable; confirm with SM brand team before launch styling (task 22); keep neutral until then |
| R-002 | "SM" / "by SM Retail" is a registered trademark of SM Investments; name and endorsement need brand + legal sign-off and a trademark search | Medium | High | High | Do not ship the name publicly until sign-off; product name is a config/token; log as open question Q28 |
| R-003 | System-font stack renders ₱ (U+20B1) or ñ inconsistently on some store PCs/tablets | Medium | Medium | Medium | Noto Sans fallback in the stack; verify on target store hardware before launch (SG-002, task 1.8) |
| R-004 | v3 prototype HTML not yet in repo; parity fixtures depend on it | Medium | Medium | Medium | User to paste v3 logic/values; parity suite (task 6.4) wired when available |
| R-005 | GitHub Flow deploys every merge to `main` straight to prod (no staging gate) | Medium | Medium | Medium | Branch protection + required PR checks; pipeline built to add a staging gate later (ADR-0004) |
| R-006 | Store coordinates are approximate (assumption A-010) | Low | Low | Low | Geocode via Amazon Location Service before production use |

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1.0 | 2026-09-30 | TBD | Initial scaffold |
| 0.2.0 | 2026-09-30 | Kiro | Added R-001…R-006 (brand divergence, trademark, font, parity, deploy, geocoding) |
