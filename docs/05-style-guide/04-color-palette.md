---
id: SG-004
title: Color palette
version: 0.3.0
status: Draft
owner: TBD
last_updated: 2026-09-30
related: [SG-000, SG-002, SG-007, SG-009, SG-010, UX-001, ADR-0003]
---

# Color palette

> **Purpose:** Colour tokens for LaneWise by SM Retail. Source of truth: brand doc "LaneWise v0.5" (`docs/references/brand/`). Token namespace `--lw-*`. Components use only the semantic tokens, never raw ramps, so dark mode is a value swap. All pairings verified WCAG AA for normal text (≥ 4.5:1) in light and dark. **Status: working design system pending SM brand + legal sign-off (GOV-003, GOV-005).**

## Design language

Square corners (radius 0), no shadows, no gradients. Solid fills are reserved for the single most important element on a screen — the primary action, the key number, or the most urgent status. Everything else uses a 2px outline (never a hairline). Accent red is for emphasis only, never for status.

## Base ramps (raw — not used directly in components)

- **primary** (blue): 50 `#eff6ff` · 100 `#dbeafe` · 200 `#bfdbfe` · 300 `#93c5fd` · 400 `#60a5fa` · 500 `#3b82f6` · 600 `#1d4ed8` · 700 `#1e40af` · 800 `#1e3a8a` · 900 `#172554`
- **accent** (red): 50 `#fef2f2` · 100 `#fee2e2` · 200 `#fecaca` · 300 `#fca5a5` · 400 `#f87171` · 500 `#ef4444` · 600 `#dc2626` · 700 `#b91c1c` · 800 `#991b1b` · 900 `#7f1d1d`
- **slate** (neutral): 0 `#ffffff` · 50 `#f8fafc` · 100 `#f1f5f9` · 200 `#e2e8f0` · 300 `#cbd5e1` · 400 `#94a3b8` · 500 `#64748b` · 600 `#475569` · 700 `#334155` · 800 `#1e293b` · 900 `#0f172a` · 950 `#020617`
- **success**: 50 `#f0fdf4` · 100 `#dcfce7` · 600 `#15803d` · 700 `#166534` · 800 `#14532d`
- **warning**: 50 `#fffbeb` · 100 `#fef3c7` · 600 `#b45309` · 700 `#92400e` · 800 `#78350f`
- **danger**: 50 `#fef2f2` · 100 `#fee2e2` · 600 `#b91c1c` · 700 `#991b1b` · 800 `#7f1d1d`
- **info**: 50 `#ecfeff` · 100 `#cffafe` · 600 `#0e7490` · 700 `#155e75` · 800 `#164e63`

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

Verified AA (normal text): text/surface 17.85:1, text-muted/surface 7.58:1, primary/surface 6.7:1, on-primary/primary 6.7:1, accent/surface 4.83:1, success 5.02:1, warning 5.02:1, danger 6.47:1, info 5.36:1; soft pairs 6.3–6.8:1.

## Semantic tokens — dark (value swap, SG-009)

`--lw-bg` #020617 · `--lw-surface` #0f172a · `--lw-surface-2` #1e293b · `--lw-text` #f1f5f9 · `--lw-text-muted` #94a3b8 · `--lw-primary` #60a5fa (on #020617) · `--lw-primary-soft` #172554 (on #bfdbfe) · `--lw-accent` #f87171 · `--lw-success` #4ade80 · `--lw-warning` #fbbf24 · `--lw-danger` #fca5a5 · `--lw-info` #22d3ee, each with dark on-colours; `--lw-outline` #94a3b8. All pairs re-verified ≥ 4.5:1. Follows the device setting; `data-theme="light"|"dark"` on the root overrides. Surfaces step lighter as they rise (bg → surface → surface-2) instead of using shadows.

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

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1.0 | 2026-09-30 | TBD | Initial scaffold |
| 0.2.0 | 2026-09-30 | Kiro | Neutral SM-flavoured placeholder palette |
| 0.3.0 | 2026-09-30 | Kiro | Adopted LaneWise v0.5: `--lw-*` semantic tokens, light+dark AA-verified, Okabe–Ito data-viz, design-language rules |
