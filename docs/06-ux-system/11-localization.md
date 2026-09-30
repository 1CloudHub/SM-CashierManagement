---
id: UX-011
title: Localization
version: 0.2.0
status: Draft
owner: TBD
last_updated: 2026-09-30
related: [SG-002, UX-003, NFR-001, ADR-0003]
---

# Localization

> **Purpose:** Defines how LaneWise externalises and formats all user-facing text, dates, numbers and ₱ amounts so the UI ships in English and Filipino with nothing hardcoded (spec Req 23, NFR-L10N-001).

## Principles

- **Two locales from launch:** English (`en-PH`) and Filipino (`fil-PH`). English is the canonical key set; Filipino must cover it exactly.
- **Nothing hardcoded:** every string, date, number and ₱ amount is resolved from a resource bundle or a locale-aware formatter. Copy never appears inline in a component.
- **Persisted per user:** the language choice is stored (locally now, `User.language` server-side once auth lands) and reflected on `<html lang>` so browsers and assistive tech announce correctly.
- **Staff screens first:** My roster, offers, notifications and requests are the priority for translation; admin screens follow.

## Standards

- **Resource bundles** are flat maps from a stable dotted message id (`action.save`, `state.empty.title`, `error.404.title`) to a localised template. `{name}` placeholders are interpolated at render. Ids are stable and never reused for different copy.
- **Language switcher** appears in the top bar (compact `EN` / `FIL`) and in Profile (SCR-080, full endonyms `English` / `Filipino`). It is a labelled `<select>` (accessible name from the bundle) and persists the choice.
- **Locale-aware formatting** goes through shared formatters (`Intl.NumberFormat` / `Intl.DateTimeFormat` on the locale tag) — never manual string building.
- **Currency ₱ (SG-002):** amounts are formatted as PHP for the locale and the symbol is normalised to the Unicode peso sign ₱ (U+20B1) — never a hardcoded "P", "PHP" or literal glyph in copy. Rendered with the `--font-num` stack (which carries U+20B1 via Noto Sans) and tabular figures so ₱ renders across platforms and columns align. A shared Currency/Num component enforces this.
- **Fallback:** a missing key falls back to English, then to the id itself (visible in development), so gaps fail loudly rather than blank.
- **Emails and push** use the recipient's language preference (NFR-L10N-002).

## Specification

Implemented in the frontend under `src/i18n/`:

- `types.ts` — `Locale` (`en` | `fil`), locale tags (`en-PH` / `fil-PH`), labels and short codes.
- `resources.ts` — the `en` / `fil` bundles and the canonical microcopy reference (see UX-003).
- `translate.ts` — the pure resolver: locale → English → id, with `{name}` interpolation.
- `format.ts` — `formatCurrency` / `formatCurrencyCompact` (₱ / U+20B1), `formatNumber`, `formatPercent`, `formatDate` / `formatTime` / `formatDateTime`.
- `context.tsx` — `I18nProvider` (holds + persists the locale, syncs `<html lang>`) and `useI18n()` / `useT()`.
- `language-switcher.tsx` — `LanguageSwitcher` (`compact` for the top bar, `full` for Profile).
- `src/components/ui/currency.tsx` — the shared `Currency` / `Num` renderer (SG-002).

Error/status page copy (SCR-090) flows through the same bundles (`error.*`, `action.*`, `a11y.*`); `src/components/errors/messages.ts` projects the bundle into its resolvers so all copy shares one mechanism.

## Acceptance criteria

- The UI renders in English and Filipino; switching updates every consumer and persists across reloads.
- No user-facing string, date, number or ₱ amount is hardcoded in a component; all resolve through the bundle or a formatter.
- Every ₱ amount renders with the Unicode peso sign (U+20B1), tabular figures, and right-aligned in columns.
- Each locale bundle covers exactly the English key set (asserted by test); a missing key falls back visibly.
- `<html lang>` reflects the active locale.

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1.0 | 2026-09-30 | TBD | Initial scaffold |
| 0.2.0 | 2026-09-30 | Kiro | Filled localization standard: en/fil bundles, language switcher, locale-aware date/number/₱ formatting, shared Currency/Num, persistence; mapped to the `src/i18n` implementation (task 1.8) |
