---
id: SG-004
title: Color palette
version: 0.5.0
status: Draft
owner: TBD
last_updated: 2026-10-01
related: [SG-000, SG-002, SG-007, SG-009, SG-010, UX-001, ADR-0003]
---

# Color palette

> **Purpose:** Colour tokens for LaneWise by SM Retail. Source of truth: brand doc "LaneWise v0.5" (`docs/references/brand/`). Token namespace `--lw-*`. Components use only the semantic tokens, never raw ramps, so dark mode is a value swap. All pairings verified WCAG AA for normal text (≥ 4.5:1) in light and dark. **Status: working design system pending SM brand + legal sign-off (GOV-003, GOV-005).**

## Design language

Square corners (radius 0), no shadows, no gradients. Solid fills are reserved for the single most important element on a screen — the primary action, the key number, or the most urgent status. Everything else uses a thin 1px outline in an AA non-text colour (≥ 3:1); decorative containers (cards, table frames) use the subtle outline. Focus indicators stay 2px. Accent red is for emphasis only, never for status.

## Base ramps (raw — not used directly in components)

- **primary** (blue): 50 `#eff6ff` · 100 `#dbeafe` · 200 `#bfdbfe` · 300 `#93c5fd` · 400 `#60a5fa` · 500 `#3b82f6` · 600 `#1d4ed8` · 700 `#1e40af` · 800 `#1e3a8a` · 900 `#172554`
- **accent** (red): 50 `#fef2f2` · 100 `#fee2e2` · 200 `#fecaca` · 300 `#fca5a5` · 400 `#f87171` · 500 `#ef4444` · 600 `#dc2626` · 700 `#b91c1c` · 800 `#991b1b` · 900 `#7f1d1d`
- **slate** (neutral): 0 `#ffffff` · 50 `#f8fafc` · 100 `#f1f5f9` · 200 `#e2e8f0` · 300 `#cbd5e1` · 400 `#94a3b8` · 500 `#64748b` · 600 `#475569` · 700 `#334155` · 800 `#1e293b` · 900 `#0f172a` · 950 `#020617`
- **success** (green): 50 `#f0fdf4` · 100 `#dcfce7` · 300 `#86efac` · 400 `#4ade80` · 600 `#15803d` · 700 `#166534` · 800 `#14532d` · 950 `#052e16`
- **warning** (amber): 50 `#fffbeb` · 100 `#fef3c7` · 300 `#fcd34d` · 400 `#fbbf24` · 600 `#b45309` · 700 `#92400e` · 800 `#78350f` · 950 `#451a03`
- **danger** (rose): 50 `#fef2f2` · 100 `#fee2e2` · 600 `#b91c1c` · 700 `#991b1b` · 800 `#7f1d1d` · 950 `#450a0a`
- **info** (cyan): 50 `#ecfeff` · 100 `#cffafe` · 300 `#67e8f9` · 400 `#22d3ee` · 600 `#0e7490` · 700 `#155e75` · 800 `#164e63` · 950 `#083344`
- **categorical** (`--lw-cat-*`, feeds `--lw-viz-*`): strong (light) blue `#0060a8` · vermillion `#c24f00` · green `#00795b` · pink `#b2548c` · sky `#2b8cc4`; bright (dark) blue `#56b4e9` · vermillion `#ff8a4c` · green `#2ec4a0` · pink `#e79cc7` · sky `#5fd3e0`

Every raw hex lives in these ramps in `frontend/src/styles/tokens.css`; semantic tokens (including on-colours such as white `--lw-slate-0`) only reference ramps.

## Semantic tokens — light (default)

| Token | Value | On-token | Value |
|---|---|---|---|
| `--lw-bg` | #f1f5f9 | `--lw-text` | #0f172a |
| `--lw-surface` | #ffffff | `--lw-text` | #0f172a |
| `--lw-surface-2` | #f8fafc | `--lw-text-muted` | #475569 |
| `--lw-primary` | #1d4ed8 | `--lw-on-primary` | #ffffff |
| `--lw-primary-soft` | #dbeafe | `--lw-on-primary-soft` | #1e40af |
| `--lw-accent` | #dc2626 | `--lw-on-accent` | #ffffff |
| `--lw-success` | #15803d | `--lw-on-success` | #ffffff |
| `--lw-warning` | #b45309 | `--lw-on-warning` | #ffffff |
| `--lw-danger` | #b91c1c | `--lw-on-danger` | #ffffff |
| `--lw-info` | #0e7490 | `--lw-on-info` | #ffffff |
| `--lw-success-soft` | #dcfce7 | `--lw-on-success-soft` | #166534 |
| `--lw-warning-soft` | #fef3c7 | `--lw-on-warning-soft` | #92400e |
| `--lw-danger-soft` | #fee2e2 | `--lw-on-danger-soft` | #991b1b |
| `--lw-info-soft` | #cffafe | `--lw-on-info-soft` | #155e75 |
| `--lw-outline` | #64748b | 2px neutral outline (4.8:1 on surface) |
| `--lw-outline-subtle` | #cbd5e1 | decorative only, never for meaning |

Contrast is verified automatically in both themes — see [Contrast verification](#contrast-verification).

## Semantic tokens — dark (value swap, SG-009)

| Token | Value | On-token | Value |
|---|---|---|---|
| `--lw-bg` | #020617 | `--lw-text` | #f1f5f9 |
| `--lw-surface` | #0f172a | `--lw-text` | #f1f5f9 |
| `--lw-surface-2` | #1e293b | `--lw-text-muted` | #94a3b8 |
| `--lw-primary` | #60a5fa | `--lw-on-primary` | #020617 |
| `--lw-primary-soft` | #172554 | `--lw-on-primary-soft` | #bfdbfe |
| `--lw-accent` | #f87171 | `--lw-on-accent` | #020617 |
| `--lw-success` | #4ade80 | `--lw-on-success` | #020617 |
| `--lw-warning` | #fbbf24 | `--lw-on-warning` | #020617 |
| `--lw-danger` | #fca5a5 | `--lw-on-danger` | #020617 |
| `--lw-info` | #22d3ee | `--lw-on-info` | #020617 |
| `--lw-success-soft` | #052e16 | `--lw-on-success-soft` | #86efac |
| `--lw-warning-soft` | #451a03 | `--lw-on-warning-soft` | #fcd34d |
| `--lw-danger-soft` | #450a0a | `--lw-on-danger-soft` | #fca5a5 |
| `--lw-info-soft` | #083344 | `--lw-on-info-soft` | #67e8f9 |
| `--lw-outline` | #94a3b8 | 2px neutral outline |
| `--lw-outline-subtle` | #334155 | decorative only |

The device-dark block and the `data-theme="dark"` block in `tokens.css` must stay identical; the contrast suite asserts this and that dark only re-declares tokens that exist in light (a pure value swap). Follows the device setting; `data-theme="light"|"dark"` on the root overrides. Surfaces step lighter as they rise (bg → surface → surface-2) instead of using shadows.

## Brand roles and logo (task 22)

The brand mark, the reversed primary app bar and the endorsement read their own roles, never `--lw-primary` directly, so an SM re-brand can move the bar (for example to SM navy) independently of the action colour. They are defined by reference, so the dark value swap flows through.

| Token | Default | Use |
|---|---|---|
| `--lw-brand` / `--lw-on-brand` | `--lw-primary` / `--lw-on-primary` | brand tile, wordmark; lanes in the tile |
| `--lw-appbar` / `--lw-on-appbar` | `--lw-brand` / `--lw-on-brand` | reversed primary app bar and the 2px controls on it |
| `--lw-brand-endorsement` | `--lw-text-muted` | "by SM Retail" on surfaces |
| `--lw-scrim` | slate-950 at 55% | dialog/drawer backdrop |

Tailwind utilities: `bg-brand`, `fill-on-brand`, `bg-appbar`, `text-on-appbar`, `border-on-appbar`, `fill-brand-endorsement`, `bg-scrim`.

**Logo.** `BrandMark` (`frontend/src/components/brand/brand-mark.tsx`) draws the concept mark: a square tile with three checkout lanes of rising height on a shared floor line, the "LaneWise" wordmark and the "by SM Retail" endorsement (both from the i18n bundles, so Filipino renders "ng SM Retail").

- `variant="default"` on page and surface backgrounds; `variant="reversed"` on the primary app bar (tile and text in `--lw-on-appbar`, lanes in the bar colour).
- `lockup="full"` (mark + wordmark + endorsement) or `lockup="mark"` (tile only, legible at 16px, for the nav rail).
- One `role="img"` with the accessible name "LaneWise by SM Retail"; coloured only through the brand-role `fill-*` utilities.
- `frontend/public/favicon.svg` is the same tile. Favicons cannot read CSS variables, so it carries the light brand values as the one intentional raw-hex asset.

The shell's top bar still shows its text lockup; switching it to `<BrandMark variant="reversed" />` on a `bg-appbar` bar is left to the shell work (`frontend/src/components/shell`).

## Data-visualisation palette (SG-010)

Okabe–Ito-based, colour-blind-safe, adjusted for contrast (checked against protanopia/deuteranopia/tritanopia simulations). Every series is labelled directly and has its own marker shape; never colour or legend alone. Max 6 series, used in order.

| Token | Light | Dark | Name |
|---|---|---|---|
| `--lw-viz-1` | #0060a8 | #56B4E9 | Blue |
| `--lw-viz-2` | #c24f00 | #FF8A4C | Vermillion |
| `--lw-viz-3` | #00795b | #2EC4A0 | Green |
| `--lw-viz-4` | #b2548c | #E79CC7 | Pink |
| `--lw-viz-5` | #1e293b | #e2e8f0 | Neutral |
| `--lw-viz-6` | #2b8cc4 | #5fd3e0 | Sky |

## Rules

- Accent red = emphasis, at most one hero use per screen; never status.
- Status always pairs a word + icon + colour (tick Covered, exclamation Tight, cross Short) — colour never alone (protects red-green colour blindness).
- Solid chip for the one status that matters most; outline chips for the rest.

## Contrast verification

`frontend/src/styles/tokens.contrast.test.ts` (run by `npm test`) reads `tokens.css`, resolves every semantic token for light and dark the way the browser does, and computes the WCAG ratio for each pair listed in `CONTRAST_PAIRS` (`frontend/src/styles/contrast.ts`). It fails if a text pair is below **4.5:1** or a non-text pair (2px outlines, focus ring, status fills, chart series) is below **3:1**. A new fill role must add its pair there. Ratios at v0.4.0 (lowest per theme in bold):

| Pair | Kind | Light | Dark |
|---|---|---|---|
| `text` on `bg` / `surface` / `surface-2` | text | 16.30 / 17.85 / 17.06 | 18.41 / 16.30 / 13.35 |
| `text-muted` on `bg` / `surface` / `surface-2` | text | 6.92 / 7.58 / 7.24 | 7.87 / 6.96 / **5.71** |
| `on-primary` on `primary` | text | 6.70 | 7.93 |
| `on-primary-soft` on `primary-soft` | text | 7.15 | 10.34 |
| `on-accent` on `accent` | text | **4.83** | 7.29 |
| `on-success` / `on-warning` / `on-danger` / `on-info` on fill | text | 5.02 / 5.02 / 6.47 / 5.36 | 11.58 / 12.08 / 10.63 / 11.16 |
| soft status pairs (success / warning / danger / info) | text | 6.49 / 6.37 / 6.80 / 6.49 | 10.62 / 10.39 / 8.51 / 9.24 |
| status colour as text on `surface` | text | 5.02 / 5.02 / 6.47 / 5.36 | 10.25 / 10.69 / 9.41 / 9.88 |
| `primary` on `surface` / `bg` (links) | text | 6.70 / 6.12 | 7.02 / 7.93 |
| `accent` on `surface` | text | **4.83** | 6.45 |
| `on-brand` on `brand`, `on-appbar` on `appbar` | text | 6.70 | 7.93 |
| `brand` on `surface` / `bg` (wordmark) | text | 6.70 / 6.12 | 7.02 / 7.93 |
| `brand-endorsement` on `surface` / `bg` | text | 7.58 / 6.92 | 6.96 / 7.87 |
| `outline` on `bg` / `surface` / `surface-2` | non-text | 4.34 / 4.76 / 4.55 | 7.87 / 6.96 / 5.71 |
| `focus-ring` on `surface` / `bg` / `primary-soft` | non-text | 6.70 / 6.12 / 5.49 | 7.02 / 7.93 / 5.78 |
| `viz-1`…`viz-6` on `surface` | non-text | 6.48 / 4.76 / 5.40 / 4.63 / 14.63 / 3.72 | 7.74 / 7.64 / 8.09 / 8.48 / 14.48 / 10.10 |
| `viz-1`…`viz-6` on `bg` | non-text | 5.92 / 4.34 / 4.93 / 4.22 / 13.35 / **3.39** | 8.74 / 8.64 / 9.14 / 9.58 / 16.36 / 11.41 |

All 106 pair checks pass. Automated contrast is necessary, not sufficient: full WCAG 2.2 AA conformance still needs manual assistive-technology and colour-blindness review.

## Swapping the brand

**Status (Q8 / Q28):** LaneWise v0.5 is a working concept. SM brand and legal sign-off on the name, the "by SM Retail" endorsement, the primary blue (#1d4ed8 vs SM navy) and a trademark search is **pending**; this procedure applies once SM's official guidelines arrive.

1. **Ramps.** In `frontend/src/styles/tokens.css`, replace the hex values of the primary (blue), accent (red) and, if needed, neutral (slate) ramps with SM's. Keep the stop names (50–950) so semantic references still resolve; add stops rather than renaming.
2. **Semantic and brand roles.** If SM's primary is too dark or light for a stop's current role, re-point the semantic tokens (light `:root` and both dark blocks, kept identical). To give the app bar or mark a different colour from actions, point `--lw-brand` / `--lw-appbar` at the new ramp stops instead of `--lw-primary`.
3. **Typography.** If SM supplies a licensed typeface, load it (self-hosted, `font-display: swap`) and put it first in `--lw-font-sans` / `--lw-font-num`, keeping the system stack and Noto Sans behind it for Ñ/ñ and ₱ (SG-002).
4. **Logo.** Replace the geometry in `BrandMark` (`LaneTile` and the wordmark block), keeping the `variant` / `lockup` props and brand-role fills so call sites don't change; re-export `frontend/public/favicon.svg` from the new mark; update the endorsement strings in the i18n bundles if SM changes the wording.
5. **Verify.** Run `npm test` in `frontend`: the contrast suite fails on any pair below AA in either theme. Fix by moving to a darker/lighter stop, never by lowering the threshold. Review the Foundations section of the component gallery in light and dark, then update the tables in this document and the wireframe stylesheet (`.kiro/specs/cashier-staffing-planner/wireframes/wireframe.css`).
6. Record SM's approval against Q28 in GOV-005 and bump this document.

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1.0 | 2026-09-30 | TBD | Initial scaffold |
| 0.2.0 | 2026-09-30 | Kiro | Neutral SM-flavoured placeholder palette |
| 0.3.0 | 2026-09-30 | Kiro | Adopted LaneWise v0.5: `--lw-*` semantic tokens, light+dark AA-verified, Okabe–Ito data-viz, design-language rules |
| 0.4.0 | 2026-09-30 | Claude | Task 22: brand + app-bar roles, dark soft tokens, all hex moved into ramps, BrandMark component, automated contrast suite, "Swapping the brand" procedure (Q8/Q28 sign-off pending) |
| 0.5.0 | 2026-10-01 | Claude | 1px outlines (thinner, more modern); cards/table frames on the subtle outline; 2px focus ring |
