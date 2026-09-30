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

The SPA imports `@lanewise/shared` (roles, email allowlist, session policy,
API contracts); build it first: `(cd ../packages/shared && npm ci && npm run build)`.

## Sign-in (Cognito passkeys, task 7)

The app sits behind passkey sign-in (`src/features/auth`, `src/app/root.tsx`).
At start-up it loads `/runtime-config.json` (written by the deploy stage from
the CDK outputs) or, locally, these Vite env vars:

```bash
VITE_COGNITO_USER_POOL_ID=ap-southeast-1_XXXXXXXXX
VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_SELF_SIGN_UP=true
```

Passkeys are bound to the pool's relying-party domain, so real sign-in only
works on that domain. Without any config, `npm run dev` runs the app shell
without sign-in (for UI work) and a production build fails closed (503 page).

## App skeleton, roles and the API client (task 8.2)

- **Routes** — `src/app/screens.ts` is the screen map: one react-router route
  per screen (SCR-010 … SCR-091), its roles (the wireframe `data-page-roles`)
  and the side-nav groups (the wireframe `NAV` table; `access.test.ts` parses
  both, so drift fails CI). Unbuilt screens render a placeholder naming their
  spec task. A role that may not open a screen gets the "No access" state, and
  its nav item is hidden. The component gallery is at `/gallery`.
- **"Viewing as"** — the demo role switcher (all 8 roles) persists per user in
  localStorage; switching keeps the page if the new role may open it, else
  goes Home.
- **API client** — `src/api` (`useApi()`): typed methods over a transport
  adapter. Every request sends `X-Active-Role`; the server enforces it (task
  8.1). Add endpoints to `client.ts` and a mock route to `mock.ts`.

| Env var | Default | Effect |
| --- | --- | --- |
| `VITE_DEMO_ROLE_SWITCHER` | on | `false` hides the switcher; the role comes from the user's assignments |
| `VITE_API_MOCK` | on | `false` calls the real API (`apiUrl` from runtime config) instead of the in-memory mock; the sample-data banner shows while the mock is on |

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
