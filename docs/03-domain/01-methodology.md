---
id: DOM-001
title: Staffing methodology
version: 0.3.0
status: Draft
owner: TBD
last_updated: 2026-09-30
related: [FS-001, FS-002, FS-003, FS-004, FS-006, DOM-003, DOM-004]
---

# Staffing methodology

> **Purpose:** Defines the calculation pipeline the planner uses to turn sales history into lane requirements, rosters and a seasonal hiring plan, and sets the numeric tolerance for "prototype parity" (spec Requirement 4, Property 2).

## Pipeline overview

Sales history → hourly demand forecast → Erlang C lane requirement (service target) → shrinkage uplift → shift construction → named weekly roster under PH labor rules → network seasonal hiring plan → cost model → leadership summary.

Each stage consumes the previous stage's output plus a pinned **rules version** (DOM-003) and **data snapshot**. The rebuild reproduces the prototype v3 method stage-for-stage; see "Parity tolerance" for what "reproduce" means numerically.

## Demand forecasting model

- Unit of work: transactions (and items) per department per 30-minute interval.
- Base profile: historical average for the same weekday-and-interval over the trailing sample window, seasonally scaled for the planning period (e.g. Christmas uplift factors).
- Output: expected arrivals λ per interval per department.

## Erlang C lane sizing

- For each interval, size the number of open lanes so the probability of waiting and the target service level meet the configured target (e.g. X% served within Y seconds; targets live in DOM-003).
- Inputs: arrival rate λ (from the forecast), average handle time per department (master data), target service level.
- Output: required open lanes per interval, capped by installed lanes.

## Shrinkage

- Apply a shrinkage uplift (breaks, meals, training, absence) to convert "lanes that must be open" into "cashiers that must be rostered". Shrinkage factors live in DOM-003.

## Shift construction

- Build shifts covering the required-cashiers curve using allowed shift patterns, minimum/maximum shift length, meal-break placement and lane-open/close ramp rules.
- Objective: cover demand with the fewest paid hours while respecting rules.

## Roster assignment

- Assign named staff to shifts honoring contract type (FT/PT/float), preferred rest day, availability pattern and PH labor rules: maximum consecutive working days (6), weekly hours, minimum rest between shifts (≥ 10 h), and the mandatory 24-hour rest after 6 consecutive working days.

## Team sizing

- Convert the rostered-hours requirement over the season into headcount by store, department and contract type, including a recruiting buffer.

## Hiring plan

- Difference between required team size and current staff, phased by recruiting lead times (DOM-003) into hiring waves with milestone dates.

## Cost model

- Cost = paid hours × applicable wage rate × premium multipliers (night, holiday, overtime), by store and department, from the wage and multiplier rule versions (DOM-003).

## Parity tolerance

The rebuild is considered at parity with prototype v3 when, for the **same data snapshot, rules version and settings**:

| Output | Tolerance vs v3 |
|---|---|
| Hourly demand forecast (λ per interval) | exact to 4 decimal places |
| Required lanes per interval (integer) | exact match |
| Required cashiers per interval after shrinkage (integer) | exact match |
| Shift count and total paid hours per department/day | exact match |
| Roster assignments (who works which shift) | may differ where the assignment problem has ties; the **set of shifts** and total hours must match exactly |
| Season headcount by store/role | exact match |
| Season cost (₱) | within ±0.5% (rounding of intermediate wage math) |

Notes:
- Integer outputs (lanes, cashiers, headcount) must match exactly; only floating-point intermediates carry a tolerance.
- Where v3 used a non-deterministic tie-break in roster assignment, parity is checked on the invariant outputs (shift set, hours, coverage), not the specific name-to-shift mapping.
- Parity tests use the seeded demo snapshot so results are reproducible (see spec Requirement 19).

## Parity fixtures (from prototype v3 report)

These are the concrete anchors the parity suite (spec task 6.4) asserts against. Sourced from the SM Retail Cashier Staffing report (`docs/references/prototype-v3/`). All figures are from **synthetic sample data** (8 stores, 24 departments, 47,548 hourly rows, Aug 1 – Dec 31 2025).

### Fixture A — Erlang C worked example (exact)

Inputs: λ = 240 transactions/hour (4/min), average handle time h = 2.5 min (μ = 0.4/min), offered load A = λ·h = 10 Erlangs. A delay system needs strictly more than 10 lanes, so 11 is the stability floor.

| Cashiers c | Utilization ρ | P(wait) | Avg queue wait | % served within 1 min |
|---|---|---|---|---|
| 11 | 0.91 | 0.68 | ~102 s | 54% |
| 12 | 0.83 | 0.45 | ~34 s | 80% |
| **13** | **0.77** | **0.28** | **~14 s** | **91%** |
| 14 | 0.71 | 0.17 | ~7 s | 97% |
| 15 | 0.67 | 0.10 | ~3 s | 99% |

- **Assertion:** for a "90% within 60 s" target, the engine must return **13** cashiers (min c meeting the target). Utilization, P(wait) and % values match the table within rounding (utilization/P(wait) to 2 dp; avg wait is derivative and checked ±10%).
- After choosing 13, shrinkage ×1.25–1.40 gives ~16–18 scheduled cashiers for that hour.

### Fixture B — Demo dataset shape (exact)

- 47,548 rows; 8 stores across 4 formats (Supermarket, Hypermarket, SM Store, SaveMore); 24 departments; hourly Aug 1 – Dec 31 2025.
- Columns: store, format, region, department, date, day of week, day type, payday flag, day note, hour, transactions, items, sales, average handle time, lanes open, lanes installed.
- Built-in understaffing pattern (last-year lanes-open template): ~19% of trading hours short in August rising to ~59% in December. This is a property of the simulation used to exercise the coverage check, **not** a claim about SM.

### Fixture C — Scenario outputs (integers exact; cost ±0.5%)

Season/date context: forecast window Oct–Dec 2026; growth and factors learned from 2025.

| Scenario | Expected output |
|---|---|
| SM Supermarket – Quezon City, main lanes, Sat Dec 19 2026 | 3,863 forecast transactions (2.25× a normal weekday); **19** cashiers at the 1 PM peak (vs 12 on a normal weekday) |
| SM Store – Manila, Kids & toys, Sun Dec 20 2026 | 3.9× a normal weekday |
| Network (all 8 stores), Dec 19 2026 | **254** cashiers on lanes at the 5 PM peak; roster calls for **555** cashiers (**314** FT · **188** PT · **53** float); **3,688** paid hours; season cost ≈ **₱322,000** |
| SM Hypermarket – Pampanga, Dec 19 2026 | busiest single store: **46** cashiers at noon |
| Over-capacity flags, Christmas Eve | Pampanga main lanes need all **44** installed; Cebu City main lanes **26** vs **24** installed; SaveMore Iloilo **13** vs **12** installed |
| Part-time saving, network Dec 19 | ~5% fewer paid hours with PT allowed (**3,688** vs **3,880** FT-only); QC main lanes Dec 19 ~3% (**296** vs **304**); QC Dec 20 no saving (**304** either way) |

- **Consistency invariant:** the single-department view and the all-stores view must return identical figures for the same store/department/date (the report verified this across all 24 departments on 9 dates: incl. Christmas Eve, Christmas Day, Rizal Day, paydays).
- **Roster invariant:** no hour left short; every full-time meal break placed inside its allowed window (holds in every tested scenario).

### Notes on the v3 model (to reproduce)

- Forecast factors: Mon–Thu baseline, day-of-week factors, payday factor, seasonal factors per sub-period (Aug–mid-Sep, late Sep, Oct, Nov 1–15, Nov 16–30, Dec 1–10, Dec 11–17, Dec 18–23, Dec 26–29) and per fixed holiday; hourly shapes for weekday / Saturday / Sunday-holiday (separate December shapes); handle times by period.
- Lane sizing: Erlang C to a "% served within X s" target, then shrinkage, then a minimum-lane floor; flag hours where need > installed.
- Shift builder: FT for base load, PT for short peaks, one 1-hour meal break per FT shift placed in the hour with most spare cover, relief shifts for gaps, float cashiers around the peak.
- Cost: PH day-type multiplier + 10% night differential after 22:00.
- v3 limitations to preserve/track: departments rostered independently (store peak = sum of department needs in the same hour); shifts start on the hour; no availability/rest-day/weekly-hour limits in v3 (the rebuild adds these — see spec Req 4/6/7).

## Known limitations

- Public-transport travel times for cross-store matching are estimated with a speed factor until a transit data source is chosen (spec Q22).
- Store coordinates in demo data are approximate (assumption A-010).
- The prototype's synthetic profiles cover 8 sample stores; network-scale behavior is validated against seeded demo data, not production POS.

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1.0 | 2026-09-30 | TBD | Initial scaffold |
| 0.2.0 | 2026-09-30 | Kiro | Filled pipeline stages and added the parity tolerance table (supports spec Req 4.2 / Property 2) |
| 0.3.0 | 2026-09-30 | Kiro | Added parity fixtures A–C from the prototype v3 report (Erlang example, dataset shape, scenario outputs) |
