---
id: SG-007
title: Motion and animation
version: 0.3.0
status: Draft
owner: TBD
last_updated: 2026-09-30
related: [SG-000, SG-004, UX-001, UX-010, ADR-0003]
---

# Motion and animation

> **Purpose:** Motion tokens for LaneWise by SM Retail (brand doc v0.5). Namespace `--lw-*`. Motion is functional (feedback, continuity), never decorative-only, and respects reduced-motion.

## Duration tokens

| Token | ms | Use |
|---|---|---|
| `--lw-dur-instant` | 0 | reduced-motion / immediate |
| `--lw-dur-fast` | 120 | hover, press, tab fill, every exit |
| `--lw-dur-base` | 200 | dialog and toast enter, drop snap |
| `--lw-dur-slow` | 320 | panels, drawers, theme change |
| `--lw-dur-shimmer` | 1500 | skeleton loop |
| `--lw-toast-hold` | 5000 | toast dwell (pauses on hover/focus) |

## Easing tokens

- `--lw-ease-standard`: `cubic-bezier(0.2, 0, 0, 1)` — moves on screen.
- `--lw-ease-enter`: `cubic-bezier(0, 0, 0.2, 1)` — arriving, decelerate.
- `--lw-ease-exit`: `cubic-bezier(0.4, 0, 1, 1)` — leaving, accelerate.
- `--lw-ease-linear`: continuous motion (progress, skeleton shimmer).

## Standard transitions

| Pattern | Motion |
|---|---|
| Dialog | enter 200 ms fade + scale 0.98→1; exit 120 ms |
| Toast | enter 200 ms rise 8px + fade; holds 5 s (pause on hover/focus); exit 120 ms |
| Tabs | fill cross-fade 120 ms; no sliding underline |
| Skeleton | opacity pulse 1.5 s linear |
| Timeline drag | follows pointer, no easing; snaps to the hour on drop (200 ms); arrow keys move 1 h |
| Panel / drawer | slide + fade, 320 ms |

## Reduced motion

- `@media (prefers-reduced-motion: reduce)`: movement durations → 0; only short opacity fades (≤120 ms) remain; skeleton pulse becomes a static fill; dialogs/toasts appear in place without scale/slide.
- **Nothing relies on motion alone** — every animated change also shows as text, colour or position (toasts announced to screen readers, dragged shifts show the new time as text, loading says "Loading").
- No parallax, autoplay or looping motion outside loading states.

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1.0 | 2026-09-30 | TBD | Initial scaffold |
| 0.2.0 | 2026-09-30 | Kiro | Placeholder motion tokens |
| 0.3.0 | 2026-09-30 | Kiro | Adopted LaneWise v0.5 motion tokens (`--lw-*`), transitions, reduced-motion policy |
