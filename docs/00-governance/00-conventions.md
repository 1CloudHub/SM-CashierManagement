---
id: GOV-000
title: Documentation conventions
version: 0.1.0
status: Draft
owner: TBD
last_updated: 2026-09-30
related: []
---

# Documentation conventions

> **Purpose:** How project documents are named, identified, versioned and approved.

## Folder layout

- `docs/NN-section/` — project-wide specifications, one folder per section.
- `docs/references/` — source material (read-only). Never edit; supersede with a new version instead.
- `docs/_templates/` — templates for new documents.
- `.kiro/steering/` — short, agent-facing rules distilled from `docs/`.
- `.kiro/specs/<feature>/` — per-feature requirements, design and tasks. These reference `docs/` IDs rather than duplicating content.

## File naming

- `NN-kebab-case.md`, where `NN` sets reading order within the folder (`00` is the index or overview).
- ADRs: `docs/00-governance/adr/ADR-NNNN-kebab-title.md`.
- Lowercase only, no spaces, no dates in file names (dates live in front matter).

## Document IDs

| Prefix | Section |
|---|---|
| GOV | Governance |
| PRD | Product |
| FS | Functional specs |
| DOM | Domain, data and methodology |
| NFR | Non-functional requirements |
| SG | Style guide |
| UX | UX system |
| TS | Tech stack |
| DEP | Deployment |
| OPS | Day 2 operations |
| SEC | Security and compliance |
| PLN | Planning and execution |
| ADR | Architecture decision records |

## Requirement IDs

`<TYPE>-<AREA>-<NNN>`, never reused once assigned.

- `FR` functional, `NFR` non-functional, `BR` business rule, `UXR` UX requirement.
- Areas: `FCST` forecast, `LANE` lane sizing, `SHIFT` shift builder, `ROSTER` roster, `NET` network view, `HIRE` hiring plan, `SCN` scenarios, `RPT` reporting, `DATA` ingestion, `AUTH` access, `PAY` pay rules, `CAL` calendar, `PERF` performance, `SEC` security, `A11Y` accessibility.
- Example: `FR-ROSTER-012`, `NFR-PERF-003`, `BR-PAY-001`.

## Front matter

Every document starts with: `id`, `title`, `version`, `status`, `owner`, `last_updated`, `related`.

## Versioning

Semantic versioning per document:

- **MAJOR** — changes approved scope or behavior (breaking).
- **MINOR** — adds requirements or sections.
- **PATCH** — wording, typos, formatting.

`0.x.y` is draft. A document becomes `1.0.0` when approved. Every change adds a row to the document's revision history and an entry in the root `CHANGELOG.md`.

## Status workflow

`Draft` → `In Review` (PR open) → `Approved` (PR merged with owner sign-off) → `Superseded` (replaced; link to successor).

## Change control

- One branch per change: `docs/<section>-<topic>` (e.g. `docs/ux-breakpoints`).
- Conventional Commits: `docs(ux): add breakpoint table`, `docs(domain): define shrinkage`.
- Approved documents change only through a PR that bumps the version.
- Phase baselines are git tags: `spec-baseline-vX.Y`.

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1.0 | 2026-09-30 | TBD | Initial scaffold |
