---
id: UX-003
title: Tone and voice
version: 0.2.0
status: Draft
owner: TBD
last_updated: 2026-09-30
related: [UX-011, SG-002]
---

# Tone and voice

> **Purpose:** Defines the one voice LaneWise speaks in and the canonical microcopy for common actions, states and errors, so tone stays consistent and every string is translatable (spec Req 23, NFR-L10N-001).

## Principles

One voice across the app: **clear, supportive, plain language.** We are knowledgeable but never instructive; we explain, we don't blame.

- **Sentence case** for labels and buttons ("Send offers", not "Send Offers" or "SEND OFFERS"). Uppercase only via the label type token.
- **Verbs on actions:** buttons say what happens — "Approve budget", "Publish plan", "Send offers" — never "OK" or a bare "Submit" where a specific verb fits.
- **Plain language, no jargon.** Prefer the everyday word.
- **No blame in errors:** say what went wrong and how to recover; never imply the user broke something. Never expose stack traces, object internals or leaked attributes.
- **Empty states** explain why and offer the next step.
- **Destructive confirmations** name the object and its effect.
- **Numbers, dates and ₱** are formatted via the localization layer (UX-011, SG-002), never written into copy.

## Standards

- **All microcopy lives in the i18n resource bundles** (`en` / `fil`), keyed by a stable dotted id. No string is hardcoded in a component. This keeps tone consistent and every word translatable.
- **Key naming:** `<area>.<thing>` — `action.*` for verbs, `state.*` for UX-010 states, `error.*` for SCR-090 pages, `a11y.*` for announcements, `lang.*` for the switcher.
- **Canonical strings:** the bundle is the single source for common actions, states and errors. Reuse an existing id before adding a new string, so the same concept reads identically everywhere.

## Specification

The canonical microcopy reference is `frontend/src/i18n/resources.ts`. Representative entries (English shown; each has a Filipino counterpart):

| Id | English |
|---|---|
| `action.save` | Save |
| `action.cancel` | Cancel |
| `action.retry` | Try again |
| `action.sendOffers` | Send offers |
| `action.publishPlan` | Publish plan |
| `action.approveBudget` | Approve budget |
| `action.recalculate` | Recalculate |
| `action.archiveScenario` | Archive scenario |
| `state.empty.title` | Nothing here yet |
| `state.noAccess.title` | You don’t have access to this |
| `state.error.title` | Something went wrong |
| `state.stale.title` | Data changed since this run |
| `state.unsaved.title` | Discard changes? |
| `error.404.title` | We could not find that page |
| `error.403.title` | You do not have access to this |
| `a11y.skipToMain` | Skip to main content |

## Acceptance criteria

- Buttons are sentence-case verbs that name the outcome; labels are sentence case.
- No error copy blames the user or exposes internals (asserted by test over `error.*`).
- All UI text resolves from the bundles; no hardcoded user-facing strings in components.
- A concept has one canonical string reused across screens.

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1.0 | 2026-09-30 | TBD | Initial scaffold |
| 0.2.0 | 2026-09-30 | Kiro | Filled voice principles + canonical microcopy reference; mapped to the i18n bundles (task 1.8) |
