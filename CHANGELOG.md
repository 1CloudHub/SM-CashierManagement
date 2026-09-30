# Changelog

All notable documentation and code changes. Format: `[doc-id or area] version — change`.

## Unreleased

- [spec] cashier-staffing-planner tasks v0.1.0: 23-task implementation plan (55 leaf tasks) with per-task requirement refs, embedded property-based tests (P1–P19), wave-based dependency graph. (2026-09-30)
- [ADR-0002] 1.0.0 — application stack decision (React+TS SPA, Node+TS API, PostgreSQL, S3, SQS workers, Cognito, SES, Amazon Location Service, CDK). (2026-09-30)
- [TS-001] 0.2.0 — summarised the chosen stack per ADR-0002. (2026-09-30)
- [DOM-001] 0.2.0 — filled methodology pipeline and added the prototype parity tolerance table (supports spec Req 4.2 / Property 2). (2026-09-30)
- [NFR-001] 0.2.0 — filled measurable NFR targets with IDs, linked to spec requirements. (2026-09-30)
- [spec] cashier-staffing-planner requirements v0.2.0: tightened parity reference to DOM-001, NFR summary references NFR IDs, added Requirements↔docs traceability table. (2026-09-30)
- [spec] cashier-staffing-planner requirements v0.1.0: 25 EARS requirements + NFR summary + property→requirement traceability, derived from design v0.7.0. (2026-09-30)
- [spec] cashier-staffing-planner design v0.7.0: added Validates: Requirements references to all 19 correctness properties. (2026-09-30)
- [spec] cashier-staffing-planner design v0.6.0 + wireframes: staff time-off/swap requests (SCR-025 requests + SCR-022 manager Requests panel, journey J11), Finance approval flow for cost rule versions (SCR-060/061, updated rule-flow diagram), English/Filipino language switcher (top bar + profile), immediate email (no digest) in profile, 60-min session-expired copy. (2026-09-30)
- [spec] cashier-staffing-planner design v0.5.0: closed all remaining open questions. Added SM brand direction (Q8), English+Filipino i18n (Q9), file-upload data sources (Q11), 60-min timeout (Q12), 5y/1y retention (Q13), immediate SES notifications (Q7), Finance approval for cost rules (Q6), store-manager own-store cost (Q4), and staff time-off/swap requests (Q18, new StaffRequest entity + Property 19). (2026-09-30)
- [spec] cashier-staffing-planner design v0.4.0: decided Q15 (self sign-up on domain allowlist), Q16 (work-email link + demo staff personas), Q17 (warn + reason; block 24-hour rest breach), Q19 (Executive only records off-system approvals); added Demo data seed and Property 18. (2026-09-30)
- [spec] cashier-staffing-planner design v0.3.0: visual roster (Day timeline, Week grid, Month), Metro Manila network map with travel-time matching, shift offers and store-to-store borrowing; cross-store sharing in scope. (2026-09-30)
- [GOV-004] 0.2.0 — A-008 closed; A-010–A-012 added. (2026-09-30)

- [spec] cashier-staffing-planner design v0.2.0: Cognito passkey sign-in (smretail.com, 1cloudhub.com), demo role switcher for all users, Staff role + My roster (SCR-025), HR headcount / Finance budget / Executive plan approval sequence with off-system records, store-manager shift editing, mobile read-only policy. (2026-09-30)

- [spec] cashier-staffing-planner design v0.1.0: roles and RBAC, journeys J1–J7, sitemap, 25 screens, clickable low-fi wireframes. (2026-09-30)
- [UX-006, UX-007] 0.1.1 — pointers to the spec design. (2026-09-30)

- [docs] Scaffolded documentation structure, conventions (GOV-000) and assumptions register (GOV-004). (2026-09-30)
