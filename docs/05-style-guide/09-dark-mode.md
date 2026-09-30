---
id: SG-009
title: Dark mode
version: 0.2.0
status: Draft
owner: TBD
last_updated: 2026-09-30
related: [SG-004, ADR-0003]
---

# Dark mode

> **Purpose:** Dark mode for LaneWise (brand doc v0.5). It is a **token value swap only** — component CSS never changes.

## Behaviour

- Same semantic token names, new values (see SG-004 dark table). Components reference tokens, so no component changes.
- Follows the device setting by default (`prefers-color-scheme`); `data-theme="light"|"dark"` on the root overrides.
- Surfaces step lighter as they rise (bg → surface → surface-2) instead of using shadows.
- Primary, accent and status colours move to lighter shades with dark on-colours; every pairing re-verified ≥ 4.5:1 (AA normal text).
- `color-scheme` is set per theme so native form controls and scrollbars match.

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1.0 | 2026-09-30 | TBD | Initial scaffold |
| 0.2.0 | 2026-09-30 | Kiro | Dark mode as a token value swap per LaneWise v0.5; AA-verified |
