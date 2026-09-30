---
id: ADR-0003
title: Design-system foundation
version: 1.0.0
status: Accepted
owner: TBD
last_updated: 2026-09-30
related: [SG-000, SG-004, SG-006, UX-001, ADR-0002]
---

# Design-system foundation

> **Purpose:** Records the UI foundation for the style guide and UX system.

## Context

The app is a React + TypeScript SPA (ADR-0002) targeting WCAG 2.2 AA, English/Filipino, four breakpoints, dense roster grids and visual planning, with SM brand styling to come (Q8). The wireframes are grayscale and token-driven.

## Decision

- **CSS/utility layer:** Tailwind CSS driven by design tokens (SM brand tokens per SG-004) exposed as CSS variables.
- **Components:** shadcn/ui — accessible components (built on Radix primitives) copied into the repo and owned by the team, themed with the tokens.
- **Tokens:** colour, typography, spacing, radius and motion defined once (SG-002/004/005/007) and consumed by Tailwind config and components.
- **Docs/preview:** a component gallery/storybook for the atomic components (SG-001/006) and states (UX-010).

## Alternatives considered

- Headless primitives + fully custom CSS: most control, more build effort; rejected for speed.
- Batteries-included library (MUI/Mantine/Chakra): fastest, but heavier and less control over the branded look.

## Consequences

- The style guide docs (SG-*) become the source for tokens; UX docs (UX-*) become component behaviour specs.
- Since components are owned in-repo, accessibility and i18n are our responsibility to verify.

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-09-30 | Kiro | Tailwind + shadcn/ui with token-driven theming |
