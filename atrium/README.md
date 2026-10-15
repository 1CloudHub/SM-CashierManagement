# SM Atrium (demo portal)

The "front door" from the SM Retail platform proposal, built as a working demo:
one sign-in, an app dock and a keyboard-first queue, opening

1. **LaneWise** (this repo's cashier staffing planner), signed in already, and
2. the **proposal deck** and **CIO executive summary**, served only to signed-in users.

Sign-in is the LaneWise Cognito user pool and SPA app client: email one-time
code or passkey, smretail.com and 1cloudhub.com addresses only (the pool's
pre-sign-up allowlist). Passkeys are bound to `prototypes.1cloudhub.com`, so one
passkey works on both `atrium.` and `lanewise.` sub-domains.

## How the pieces fit

- `src/auth.ts`: Amplify Auth (`USER_AUTH`, email code or passkey). Same client
  as LaneWise, so its tokens are valid there.
- `src/lanewise.ts`: opens LaneWise at `/atrium-handoff` and hands the session
  over with `postMessage` (exact origins on both sides; nothing in the URL).
  LaneWise's side is `frontend/src/features/auth/atrium-handoff.ts`.
- `src/content.ts` + `DeckViewer`: fetches a deck from the Atrium content API
  (Cognito JWT authorizer, `infra/lib/atrium-stack.ts`) and shows it in a
  sandboxed frame.
- Queue items, numbers and concept apps are sample data for the demo.

## Run

```bash
npm ci
npm run dev        # needs public/runtime-config.json or VITE_* vars (see src/config.ts)
npm test
npm run build
```

Deploy is part of the LaneWise pipeline (`infra/buildspec-*.yml`). The decks are
not in git; upload them with `scripts/atrium-publish-content.sh`.
