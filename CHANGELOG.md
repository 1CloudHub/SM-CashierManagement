# Changelog

All notable documentation and code changes. Format: `[doc-id or area] version — change`.

## Unreleased

- [brand] Adopted "LaneWise by SM Retail" design system v0.5 as the working design system. Renamed the product from "SM Cashier Planner" across spec, wireframes, docs, README and app shell. Saved brand reference in docs/references/brand/. (2026-09-30)
- [SG-002, SG-003, SG-004, SG-007, SG-009] 0.3–0.4 — LaneWise tokens (`--lw-*`): blue/red palette with light+dark AA-verified semantic ramps, Okabe–Ito data-viz, system-font type scale with ₱/ñ fallback, motion tokens, square/no-shadow/2px-outline shape, dark mode as a value swap. (2026-09-30)
- [GOV-003] 0.2.0 — logged brand/trademark/font/parity/deploy risks (R-001…R-006). [GOV-005] 0.2.0 — Q28 LaneWise brand+legal sign-off; Q8 superseded. [ADR-0003] 1.2.0 — LaneWise as design system of record. (2026-09-30)
- [spec] design v0.11.0 / requirements v0.3.0 — product name LaneWise by SM Retail. (2026-09-30)
- [SG-002] 0.3.0 — added a numeric/currency type token (`--font-num`) with a ₱ (U+20B1) font fallback and tabular figures; currency rendering rules for reliable peso glyph and column alignment. (2026-09-30)
- [spec] cashier-staffing-planner design v0.10.0 + tasks: currency rendering via a shared Currency/Num component (tabular ₱, glyph-safe fallback, cross-platform verification) in the i18n pattern and task 1.8. (2026-09-30)
- [SG-002, SG-003, SG-004, SG-007] 0.2.0 — neutral SM-flavoured brand as design tokens: blue primary + red accent palette with semantic and data-viz ramps (AA verified), system-font type scale, motion tokens, and a placeholder app mark with a favicon-to-hero export matrix. (2026-09-30)
- [ADR-0003] 1.1.0 — recorded the placeholder brand direction. (2026-09-30)
- [spec] cashier-staffing-planner design v0.9.0: added a token-driven grid and layout system (12/8/4 columns, gutters, margins, container widths per breakpoint) with layout primitives (Page, Grid/Col, Stack, Cluster, Split/Sidebar, Section); task 1.6 now covers grid + layout. (2026-09-30)
- [spec] cashier-staffing-planner design v0.8.0 + wireframes: added design-tokens/theme + motion, app brand mark, 4xx/5xx + offline error pages (SCR-090) with a way back to safety, microcopy/voice, ARIA/labelling standard, keyboard shortcuts + help (SCR-091), and explicit loading/skeleton states. (2026-09-30)
- [spec] cashier-staffing-planner tasks: reordered to lead with the design system, git branching (GitHub Flow), and deployment/CI-CD (S3+CloudFront SPA, Lambda+API GW, GitHub Actions+OIDC, merge-to-main deploy) plus a walking skeleton; task 1 expanded into 10 design-system subtasks; new wave-based DAG. (2026-09-30)
- [ADR-0003, ADR-0004] 1.0.0 — design-system foundation (Tailwind + shadcn/ui, token-driven) and deployment/CI-CD topology. (2026-09-30)
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
