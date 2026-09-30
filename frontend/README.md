# LaneWise frontend

React + TypeScript SPA (Vite) with Tailwind CSS and shadcn/ui, per
[ADR-0003](../docs/00-governance/adr/ADR-0003-design-system-foundation.md).

## Getting started

```bash
npm install
npm run dev      # start the dev server
npm run build    # type-check (tsc -b) + production build
npm run lint     # eslint, incl. token-usage enforcement
```

Path alias `@/*` maps to `src/*` (see `tsconfig.app.json` and `vite.config.ts`).

## Design tokens (single source of truth)

All colour, typography, spacing, radius, elevation and motion values are design
tokens (CSS variables in the `--lw-*` namespace), following the style-guide docs
(SG-002 typography, SG-004 colour, SG-005 spacing, SG-007 motion, SG-009 dark
mode). The layering is deliberate:

1. **`src/styles/tokens.css`** — the only file that holds raw values. It defines
   the primitive ramps and the semantic tokens (light default), the dark-mode
   value swap, and the reduced-motion swap.
2. **`src/index.css`** — the only place tokens are wired into Tailwind, via
   `@theme inline`. This produces token-backed utilities (`bg-primary`,
   `text-muted`, `text-kpi`, `p-4`, `duration-base`, `ease-standard`, ...).
3. **Components** — consume the token-backed utilities (or `--lw-*` variables in
   rare inline cases). They never contain raw values.

### Dark mode is a value swap

Components reference semantic tokens only. Dark mode (SG-009) re-declares the
same semantic token names with new values — no component or utility changes.
It follows `prefers-color-scheme` and can be forced with
`data-theme="light" | "dark"` on the root element.

### Brand tokens

The palette currently uses the working "LaneWise v0.5" design system adopted in
ADR-0003 / SG-004. When SM brand guidelines land (SG-004, Q8), swap the values
in `tokens.css`; nothing downstream changes.

## Token-usage enforcement

Components must not contain raw hex colours, px font sizes, or ad-hoc
timings. This is enforced two ways:

- **Lint** — `eslint.config.js` adds `no-restricted-syntax` rules over
  `src/**/*.{ts,tsx}` that flag raw hex, `font-size: <px>`, and raw
  `transition/animation` timings in string and template literals. Run
  `npm run lint`.
- **Review** — anything lint can't catch (e.g. new CSS files, edge cases) is
  checked in code review. Raw values belong only in `src/styles/tokens.css`.

Use instead: colour utilities (`bg-*`, `text-*`, `border-*`), the type scale
(`text-body`, `text-h1`, `text-kpi`, ...), the spacing scale (`p-4`, `gap-6`),
and the motion tokens (`duration-fast|base|slow`, `ease-standard|enter|exit`).
