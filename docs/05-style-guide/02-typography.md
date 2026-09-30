---
id: SG-002
title: Typography
version: 0.5.0
status: Draft
owner: TBD
last_updated: 2026-09-30
related: [SG-000, SG-004, UX-011, ADR-0003]
---

# Typography

> **Purpose:** Type tokens for LaneWise by SM Retail. Source: brand doc LaneWise v0.5. Namespace `--lw-*`. System UI stack until SM provides a licensed brand font.

## Font stack

- `--lw-font-sans`: `system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif`
- `--lw-font-mono`: `ui-monospace, "SF Mono", Menlo, Consolas, "Noto Sans Mono", monospace`
- `--lw-numeric`: `tabular-nums` — applied via `font-variant-numeric` on every number column, KPI and axis.

**Latin + Filipino coverage:** the stack covers the Filipino alphabet including Ñ/ñ and the peso sign ₱ (U+20B1); Noto Sans is the fallback when a device font lacks a glyph. Test ₱ and ñ on the store PCs and tablets before launch (GOV-003 risk).

**Brand font swap (task 22, Q8/Q28):** if SM supplies a licensed typeface, it goes first in `--lw-font-sans` / `--lw-font-num` in `frontend/src/styles/tokens.css`, with this system stack and Noto Sans kept behind it as the fallback. Components read only the tokens, so no component changes. The full brand swap procedure is in SG-004 "Swapping the brand". The component gallery's Type scale section shows a Filipino + ₱ specimen for checking coverage.

## Weights

`--lw-weight-regular 400` · `--lw-weight-medium 500` · `--lw-weight-semibold 600` · `--lw-weight-bold 700`.

## Type scale (tokens)

| Token | size / line-height / weight | Tracking | Use |
|---|---|---|---|
| `--lw-type-display` | 32 / 40 / 700 | -0.02em | sign-in hero, big headline |
| `--lw-type-h1` | 24 / 32 / 700 | -0.01em | page title |
| `--lw-type-h2` | 18 / 26 / 700 | — | section heading |
| `--lw-type-h3` | 16 / 24 / 600 | — | card heading |
| `--lw-type-body` | 14 / 22 / 400 | — | default body |
| `--lw-type-body-sm` | 13 / 20 / 400 | — | secondary/meta |
| `--lw-type-label` | 12 / 16 / 600 | 0.06em, uppercase | labels, table headers, chips |
| `--lw-type-caption` | 11 / 16 / 400 | — | captions |
| `--lw-type-kpi` | 32 / 36 / 700 | — | big numbers (always tabular) |

## Numbers and currency

- Every number in a table, card or chart axis uses `font-variant-numeric: var(--lw-numeric)` so digits align without a monospaced font.
- ₱ amounts are right-aligned, tabular, and rendered as the Unicode peso sign from data (never a hardcoded glyph or "P"), formatted per locale (en-PH / fil-PH) via a shared Currency/Num component.

## Usage

- One h1 per page; headings nest without skipping levels.
- Buttons and labels: body size / medium-semibold, sentence case (UX-003).
- Uppercase only via `--lw-type-label` with its tracking.

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1.0 | 2026-09-30 | TBD | Initial scaffold |
| 0.2.0 | 2026-09-30 | Kiro | Placeholder system-font scale |
| 0.3.0 | 2026-09-30 | Kiro | Currency/numeric token + ₱ rendering |
| 0.4.0 | 2026-09-30 | Kiro | Adopted LaneWise v0.5 type tokens (`--lw-*`), scale, weights, tabular numbers |
| 0.5.0 | 2026-09-30 | Claude | Task 22: brand font swap note, Filipino/₱ gallery specimen |
