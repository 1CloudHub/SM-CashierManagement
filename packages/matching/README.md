# @lanewise/matching

Cross-store matching for LaneWise (spec tasks 16.2 and 16.3; Req 11, 12; P15, P16).
Pure TypeScript, no I/O: the API and workers call it with data they have loaded.

## Travel-time matrix (16.2)

- `TravelTimeMatrix` — immutable lookup of minutes from a **barangay-level home area**
  (`homeAreaId` = `city|barangay`) to a store, per mode (`public_transport` / `car`) and
  time window (`weekday|weekend` × `early|midday|evening`, see `timeWindowOf`).
- `TravelTimeProvider` — injectable source. The Amazon Location Service route-matrix
  adapter (car) arrives in task 24; `FakeTravelTimeProvider` is deterministic for tests and
  the demo. `precomputeMatrix` fills every mode × window and derives public-transport times
  from car times with `DEFAULT_PT_SPEED_FACTOR` (1.5, placeholder until DOM-003 sets it)
  when the provider does not supply them.
- Ring bands: 15/30/45 min by public transport, 20/40/60 min by car (`ringBand`).

## Eligibility and ranking (16.3)

`rankCandidates(request, candidates, matrix)` returns ranked and excluded candidates for one
open shift. Hours and shifts are counted **across all stores**.

Eligibility (all must hold; excluded candidates list every failing rule):

| Code | Rule |
|---|---|
| — | Opt-in home-area consent, not withdrawn. Without it the person is dropped and only counted (`excludedWithoutConsent`), never listed. |
| `NOT_TRAINED` | Trained on the shift's department |
| `UNAVAILABLE` | Not unavailable / not a rest day on the date |
| `CROSS_STORE_OPT_OUT` | Accepts cross-store offers (or the shift is at their home store) |
| `ALREADY_ROSTERED` | No overlapping shift at any store |
| `MIN_REST` | ≥ 10 h rest to the nearest shift before and after |
| `WEEKLY_HOURS` | Monday-start week hours incl. this shift ≤ cap (FT 48, PT 30, FLOAT 40) |
| `MANDATORY_REST` | No 7th consecutive working day; 24 h rest after a 6-day run |
| `TRAVEL_UNKNOWN` | A precomputed travel time exists |
| `TOO_FAR` | Travel ≤ min(request limit, the cashier's own limit) |

Ranking: travel time ↑ → weekly-hours headroom ↓ → fairness (extra shifts this period ↑,
then recent offers ↑) → cost factor ↑ → primary department first → staff ID. The order is
total, so results are deterministic and independent of input order. Each ranked candidate
has a `reasons` list explaining its rank and `flags` (`SIXTH_CONSECUTIVE_DAY`, `CROSS_STORE`).

## Privacy (P15)

Outputs carry pseudonymous ID, home store and `{ barangay, city }` only — no name, address,
coordinates or ₱ figures. `toPublicHomeArea` copies only those two fields;
`findFineLocationKeys` deep-scans a payload for coordinate/address keys.

## Scripts

`npm ci && npm run lint && npm run build && npm test`
