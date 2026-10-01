---
id: SG-003
title: Iconography, app mark and shape
version: 0.4.0
status: Draft
owner: TBD
last_updated: 2026-10-01
related: [SG-000, SG-004, SG-005, SG-008, ADR-0003]
---

# Iconography, app mark and shape

> **Purpose:** UI icons, the LaneWise app mark, and shape/spacing rules (brand doc v0.5). Namespace `--lw-*`.

## Shape

- `--lw-radius: 0` (square corners), `--lw-shadow: none` (no shadows, no gradients).
- `--lw-outline-w: 1px` — component borders are thin 1px lines (contrast comes from the colour, ≥ 3:1); `--lw-focus-w: 2px` keeps focus indicators at 2px. Solid fills only for the single primary action, the key number, and the most urgent status; everything else outlined.

## UI icons

- One line-icon set, consistent stroke, 24px grid; sizes via tokens (16/20/24). Icons inherit `currentColor`.
- Meaningful icons have an accessible name; icon-only buttons get `aria-label` (UX-004). Never icon-alone for essential status — pair with a word.

## App mark (LaneWise)

Three flat bars rising left to right = checkout lanes and a staffing chart, with a thin cut across all three. One colour, no effects; legible from a store sign down to a 16px browser tab.

- Built as SVG, colours from brand tokens (`--lw-primary` on `--lw-on-primary`, and reversed on the primary blue).
- Wordmark lockup: mark + "LaneWise" with "by SM Retail" beneath — kept together on anything that leaves the store team.
- Clear space ≥ the width of one bar. Don't recolour, rotate, add a second colour, round corners, add shadow, or combine with the SM logo.

### Export matrix

| Context | Asset |
|---|---|
| Favicon | `lanewise_icon.svg` + PNG 16/32/48, `.ico` |
| PWA / app icon | 192, 512, 180 maskable |
| Sign-in hero / splash | reversed lockup on `--lw-primary` |
| Top bar | reversed mark (+ wordmark ≥ tablet) |
| Social / OG | 1200×630 |
| Print / mono | single-colour `currentColor` |

Source files: `lanewise_logo.svg`, `lanewise_logo_reversed.svg`, `lanewise_icon.svg` (add to `docs/references/brand/`).

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1.0 | 2026-09-30 | TBD | Initial scaffold |
| 0.2.0 | 2026-09-30 | Kiro | Placeholder mark + export matrix |
| 0.3.0 | 2026-09-30 | Kiro | Adopted LaneWise mark (three lanes), square/no-shadow/2px-outline shape rules |
| 0.4.0 | 2026-10-01 | Claude | Thinner, more modern borders: 1px component outlines, 2px focus (`--lw-focus-w`) |
