---
id: DOM-001
title: Staffing methodology
version: 0.2.0
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

## Known limitations

- Public-transport travel times for cross-store matching are estimated with a speed factor until a transit data source is chosen (spec Q22).
- Store coordinates in demo data are approximate (assumption A-010).
- The prototype's synthetic profiles cover 8 sample stores; network-scale behavior is validated against seeded demo data, not production POS.

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1.0 | 2026-09-30 | TBD | Initial scaffold |
| 0.2.0 | 2026-09-30 | Kiro | Filled pipeline stages and added the parity tolerance table (supports spec Req 4.2 / Property 2) |
