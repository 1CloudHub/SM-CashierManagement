/**
 * Candidate eligibility and ranking for an open shift (task 16.3; Req 11.3–11.5,
 * 12.2–12.5; P15, P16).
 *
 * Eligibility — a candidate is offered the shift only if ALL hold, with hours
 * and shifts counted across every store (Req 11.4):
 *   consent       opt-in home area, not withdrawn (otherwise dropped silently
 *                 and only counted — never listed, Req 12.2/12.3)
 *   NOT_TRAINED          trained (skilled) on the shift's department
 *   UNAVAILABLE          not unavailable and not a rest day on the shift date
 *   CROSS_STORE_OPT_OUT  accepts cross-store offers, or the shift is at their home store
 *   ALREADY_ROSTERED     no existing shift overlapping the window
 *   MIN_REST             >= 10 h rest to the nearest shift before and after
 *   WEEKLY_HOURS         Monday-start week hours incl. this shift <= contract cap
 *   MANDATORY_REST       no 7th consecutive working day, and a 24 h rest after
 *                        any 6-day run the shift belongs to or directly follows
 *   TRAVEL_UNKNOWN       a precomputed travel time exists for the mode/window
 *   TOO_FAR              travel <= min(request limit, candidate's own limit)
 *
 * Ranking — eligible candidates sorted by, in order (Req 11.3):
 *   1. travel time, ascending
 *   2. weekly-hours headroom after this shift, descending
 *   3. fairness: extra shifts this period, then recent offers, ascending
 *   4. cost factor (overtime / premium day multiplier; default 1), ascending
 *   5. skill: department is the candidate's primary department first
 *   6. staff ID (code-unit order) — a total order, so the result is
 *      deterministic and independent of input order.
 *
 * Outputs carry only pseudonymous ID, home store and barangay/city (Req 12.5):
 * no name, no coordinates, no address and no ₱ figure.
 */
import { dayNumber, mondayOf } from './calendar.js';
import { hasActiveConsent, toPublicHomeArea, type HomeArea, type HomeAreaConsent, type IsoDate } from './privacy.js';
import { ringBand, timeWindowOf, type RingBand, type TimeWindowId, type TravelMode, type TravelTimeMatrix } from './travel.js';

export type ContractType = 'FT' | 'PT' | 'FLOAT';

/** PH labor limits used for eligibility (defaults mirror the domain's labor rule version). */
export interface LaborLimits {
  readonly maxWeeklyHours: Readonly<Record<ContractType, number>>;
  readonly minRestBetweenShiftsHours: number;
  readonly restAfterConsecutiveDays: number;
  readonly mandatoryRestHours: number;
}

export const DEFAULT_LABOR_LIMITS: LaborLimits = {
  maxWeeklyHours: { FT: 48, PT: 30, FLOAT: 40 },
  minRestBetweenShiftsHours: 10,
  restAfterConsecutiveDays: 6,
  mandatoryRestHours: 24,
};

/** A worked or rostered shift. Hours are clock hours on `date`; `endHour` may pass 24 for overnight. */
export interface WorkShift {
  readonly shiftId: string;
  readonly storeId: string;
  readonly date: IsoDate;
  readonly startHour: number;
  readonly endHour: number;
  /** Paid hours (after unpaid breaks); defaults to `endHour - startHour`. */
  readonly paidHours?: number;
}

export interface OpenShift extends WorkShift {
  readonly departmentId: string;
}

export interface MatchCandidate {
  readonly staffId: string;
  /** Pseudonymous display ID (e.g. "XS-14"); defaults to `staffId`. Never a name. */
  readonly displayId?: string;
  readonly homeStoreId: string;
  readonly contractType: ContractType;
  /** Departments the cashier is trained on. */
  readonly skills: readonly string[];
  readonly primaryDepartmentId?: string;
  /** Opt-in home area; `null` when none is shared. */
  readonly location: HomeAreaConsent | null;
  readonly unavailableDates: readonly IsoDate[];
  readonly restDays?: readonly IsoDate[];
  /** Every shift the cashier already works or is rostered for, at ANY store. */
  readonly shifts: readonly WorkShift[];
  /** Extra (non-home, non-contract) shifts already taken this period — fairness. */
  readonly extraShiftsThisPeriod: number;
  /** Offers received recently — fairness tie-break. */
  readonly recentOffers: number;
  /** Relative cost of this shift for the cashier (1 = standard, 1.3 = premium day …). */
  readonly costIndex?: number;
}

export interface MatchRequest {
  readonly shift: OpenShift;
  readonly mode: TravelMode;
  readonly maxTravelMin: number;
  /** Matrix window; defaults to the window the shift starts in. */
  readonly window?: TimeWindowId;
  readonly limits?: LaborLimits;
}

export type ExclusionCode =
  | 'NOT_TRAINED'
  | 'UNAVAILABLE'
  | 'CROSS_STORE_OPT_OUT'
  | 'ALREADY_ROSTERED'
  | 'MIN_REST'
  | 'WEEKLY_HOURS'
  | 'MANDATORY_REST'
  | 'TRAVEL_UNKNOWN'
  | 'TOO_FAR';

export interface ExclusionReason {
  readonly code: ExclusionCode;
  readonly message: string;
}

export type CandidateFlag = 'SIXTH_CONSECUTIVE_DAY' | 'CROSS_STORE';

export interface WeeklyHours {
  /** Paid hours already scheduled in the shift's roster week, all stores. */
  readonly scheduled: number;
  readonly withShift: number;
  readonly limit: number;
  readonly headroom: number;
}

interface CandidateView {
  readonly staffId: string;
  readonly displayId: string;
  readonly homeStoreId: string;
  readonly homeArea: HomeArea;
}

export interface RankedCandidate extends CandidateView {
  readonly rank: number;
  readonly travelMin: number;
  readonly ringBand: RingBand | null;
  readonly weeklyHours: WeeklyHours;
  readonly restOk: true;
  readonly fairness: { readonly extraShiftsThisPeriod: number; readonly recentOffers: number };
  readonly primarySkill: boolean;
  readonly flags: readonly CandidateFlag[];
  /** Plain-language explanation of the rank, in ranking-key order. */
  readonly reasons: readonly string[];
}

export interface ExcludedCandidate extends CandidateView {
  readonly travelMin: number | null;
  /** Every rule the candidate fails, not just the first. */
  readonly reasons: readonly ExclusionReason[];
}

export interface MatchResult {
  readonly shiftId: string;
  readonly storeId: string;
  readonly departmentId: string;
  readonly mode: TravelMode;
  readonly window: TimeWindowId;
  readonly maxTravelMin: number;
  readonly ranked: readonly RankedCandidate[];
  readonly excluded: readonly ExcludedCandidate[];
  /** Staff left out for lack of consent; counted only, never identified (P15). */
  readonly excludedWithoutConsent: number;
}

const MODE_LABEL: Record<TravelMode, string> = { public_transport: 'public transport', car: 'car' };

const absStart = (s: WorkShift) => dayNumber(s.date) * 24 + s.startHour;
const absEnd = (s: WorkShift) => dayNumber(s.date) * 24 + s.endHour;
const paidOf = (s: WorkShift) => s.paidHours ?? s.endHour - s.startHour;

function validateShift(s: WorkShift, what: string): void {
  dayNumber(s.date);
  const ok =
    Number.isFinite(s.startHour) &&
    Number.isFinite(s.endHour) &&
    s.startHour >= 0 &&
    s.startHour < 24 &&
    s.endHour > s.startHour &&
    s.endHour - s.startHour <= 24 &&
    (s.paidHours === undefined || (Number.isFinite(s.paidHours) && s.paidHours >= 0 && s.paidHours <= s.endHour - s.startHour));
  if (!ok) throw new Error(`Invalid ${what} ${s.shiftId}: ${s.date} ${s.startHour}–${s.endHour}`);
}

/** Consecutive-day and mandatory-rest evaluation for the shift on top of `existing`. */
function consecutiveDays(shift: WorkShift, existing: readonly WorkShift[], limits: LaborLimits) {
  const all = [...existing, shift];
  const days = new Set(all.map((x) => dayNumber(x.date)));
  const d = dayNumber(shift.date);
  let lo = d;
  let hi = d;
  while (days.has(lo - 1)) lo--;
  while (days.has(hi + 1)) hi++;
  const run = hi - lo + 1;
  let breach: string | null = null;
  if (run > limits.restAfterConsecutiveDays) {
    breach = `Would be ${run} working days in a row; a ${limits.mandatoryRestHours}-hour rest is mandatory after ${limits.restAfterConsecutiveDays}.`;
  } else {
    // A 24 h rest must follow any run of `restAfterConsecutiveDays` days that
    // this shift is part of, or that this shift directly follows.
    for (const start of [...days].sort((a, b) => a - b)) {
      if (days.has(start - 1)) continue;
      let end = start;
      while (days.has(end + 1)) end++;
      if (end - start + 1 < limits.restAfterConsecutiveDays) continue;
      const endOfRun = Math.max(...all.filter((x) => dayNumber(x.date) === end).map(absEnd));
      const next = all.filter((x) => absStart(x) >= endOfRun).sort((a, b) => absStart(a) - absStart(b))[0];
      const involves = (d >= start && d <= end) || next === shift;
      if (involves && next && absStart(next) - endOfRun < limits.mandatoryRestHours) {
        breach = `Only ${absStart(next) - endOfRun} h rest after ${end - start + 1} consecutive working days (mandatory ${limits.mandatoryRestHours} h).`;
        break;
      }
    }
  }
  return { run, breach };
}

interface Evaluated {
  readonly view: CandidateView;
  readonly travelMin: number | null;
  readonly weekly: WeeklyHours;
  readonly run: number;
  readonly reasons: ExclusionReason[];
  readonly source: MatchCandidate;
}

function evaluate(req: MatchRequest, window: TimeWindowId, limits: LaborLimits, c: MatchCandidate & { location: HomeAreaConsent }, matrix: TravelTimeMatrix): Evaluated {
  const s = req.shift;
  const reasons: ExclusionReason[] = [];
  const add = (code: ExclusionCode, message: string) => {
    if (!reasons.some((r) => r.code === code)) reasons.push({ code, message });
  };

  if (!c.skills.includes(s.departmentId)) add('NOT_TRAINED', `Not trained on ${s.departmentId}.`);
  if (c.unavailableDates.includes(s.date)) add('UNAVAILABLE', `Unavailable on ${s.date}.`);
  else if ((c.restDays ?? []).includes(s.date)) add('UNAVAILABLE', `Rest day on ${s.date}.`);
  if (!c.location.crossStoreOffers && c.homeStoreId !== s.storeId) add('CROSS_STORE_OPT_OUT', 'Does not accept offers at other stores.');

  for (const o of [...c.shifts].sort((a, b) => absStart(a) - absStart(b) || (a.shiftId < b.shiftId ? -1 : 1))) {
    if (absStart(o) < absEnd(s) && absStart(s) < absEnd(o)) {
      add('ALREADY_ROSTERED', `Already rostered ${o.date} ${o.startHour}:00–${o.endHour}:00 (store ${o.storeId}).`);
      continue;
    }
    const gap = absStart(o) >= absEnd(s) ? absStart(o) - absEnd(s) : absStart(s) - absEnd(o);
    if (gap < limits.minRestBetweenShiftsHours) {
      add('MIN_REST', `Only ${gap} h rest next to the shift on ${o.date} (minimum ${limits.minRestBetweenShiftsHours} h).`);
    }
  }

  const week = mondayOf(s.date);
  const scheduled = c.shifts.filter((x) => mondayOf(x.date) === week).reduce((a, x) => a + paidOf(x), 0);
  const limit = limits.maxWeeklyHours[c.contractType];
  const withShift = scheduled + paidOf(s);
  const weekly: WeeklyHours = { scheduled, withShift, limit, headroom: limit - withShift };
  if (withShift > limit) add('WEEKLY_HOURS', `${withShift} h this week across all stores with this shift (maximum ${limit} h for ${c.contractType}).`);

  const { run, breach } = consecutiveDays(s, c.shifts, limits);
  if (breach) add('MANDATORY_REST', breach);

  const travelMin = matrix.lookup(c.location.homeArea, s.storeId, req.mode, window) ?? null;
  const maxTravel = Math.min(req.maxTravelMin, c.location.maxTravelMin);
  if (travelMin === null) add('TRAVEL_UNKNOWN', `No ${MODE_LABEL[req.mode]} travel time for this home area and window.`);
  else if (travelMin > maxTravel) add('TOO_FAR', `${travelMin} min by ${MODE_LABEL[req.mode]} exceeds the ${maxTravel}-min limit.`);

  const view: CandidateView = {
    staffId: c.staffId,
    displayId: c.displayId ?? c.staffId,
    homeStoreId: c.homeStoreId,
    homeArea: toPublicHomeArea(c.location.homeArea),
  };
  return { view, travelMin, weekly, run, reasons, source: c };
}

const costOf = (c: MatchCandidate) => c.costIndex ?? 1;
const isPrimary = (c: MatchCandidate, dept: string) => c.primaryDepartmentId === dept;

function compare(dept: string) {
  return (a: Evaluated, b: Evaluated): number =>
    (a.travelMin ?? Infinity) - (b.travelMin ?? Infinity) ||
    b.weekly.headroom - a.weekly.headroom ||
    a.source.extraShiftsThisPeriod - b.source.extraShiftsThisPeriod ||
    a.source.recentOffers - b.source.recentOffers ||
    costOf(a.source) - costOf(b.source) ||
    Number(isPrimary(b.source, dept)) - Number(isPrimary(a.source, dept)) ||
    (a.view.staffId < b.view.staffId ? -1 : a.view.staffId > b.view.staffId ? 1 : 0);
}

/**
 * Filter and rank candidates for one open shift. Pure and deterministic:
 * the same inputs (in any order) give the same result.
 */
export function rankCandidates(req: MatchRequest, candidates: readonly MatchCandidate[], matrix: TravelTimeMatrix): MatchResult {
  const s = req.shift;
  validateShift(s, 'open shift');
  if (!Number.isFinite(req.maxTravelMin) || req.maxTravelMin <= 0) throw new Error(`Invalid maxTravelMin ${req.maxTravelMin}`);
  const limits = req.limits ?? DEFAULT_LABOR_LIMITS;
  const window = req.window ?? timeWindowOf(s.date, s.startHour);

  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.staffId)) throw new Error(`Duplicate candidate staffId ${c.staffId}`);
    seen.add(c.staffId);
  }

  let excludedWithoutConsent = 0;
  const evaluated: Evaluated[] = [];
  for (const c of candidates) {
    if (!hasActiveConsent(c.location)) {
      excludedWithoutConsent++;
      continue;
    }
    for (const x of c.shifts) validateShift(x, `shift of ${c.staffId}`);
    evaluated.push(evaluate(req, window, limits, { ...c, location: c.location }, matrix));
  }

  const cmp = compare(s.departmentId);
  const eligible = evaluated.filter((e) => e.reasons.length === 0).sort(cmp);
  const excluded = evaluated
    .filter((e) => e.reasons.length > 0)
    .sort((a, b) => (a.view.staffId < b.view.staffId ? -1 : a.view.staffId > b.view.staffId ? 1 : 0));

  const ranked: RankedCandidate[] = eligible.map((e, i) => {
    const travelMin = e.travelMin as number;
    const band = ringBand(req.mode, travelMin);
    const primary = isPrimary(e.source, s.departmentId);
    const flags: CandidateFlag[] = [];
    if (e.run === limits.restAfterConsecutiveDays) flags.push('SIXTH_CONSECUTIVE_DAY');
    if (e.source.homeStoreId !== s.storeId) flags.push('CROSS_STORE');
    const cost = costOf(e.source);
    const reasons = [
      `${travelMin} min by ${MODE_LABEL[req.mode]}${band ? ` (ring ${band})` : ' (beyond the outer ring)'}`,
      `${e.weekly.headroom} h weekly headroom (${e.weekly.withShift} of ${e.weekly.limit} h with this shift, all stores)`,
      `${e.source.extraShiftsThisPeriod} extra shift(s) this period, ${e.source.recentOffers} recent offer(s)`,
      cost > 1 ? `premium cost ×${cost}` : 'standard cost',
      primary ? `${s.departmentId} is their primary department` : `trained on ${s.departmentId}`,
    ];
    if (flags.includes('SIXTH_CONSECUTIVE_DAY')) reasons.push(`${limits.restAfterConsecutiveDays}th working day in a row — ${limits.mandatoryRestHours} h rest due after`);
    return {
      ...e.view,
      rank: i + 1,
      travelMin,
      ringBand: band,
      weeklyHours: e.weekly,
      restOk: true,
      fairness: { extraShiftsThisPeriod: e.source.extraShiftsThisPeriod, recentOffers: e.source.recentOffers },
      primarySkill: primary,
      flags,
      reasons,
    };
  });

  return {
    shiftId: s.shiftId,
    storeId: s.storeId,
    departmentId: s.departmentId,
    mode: req.mode,
    window,
    maxTravelMin: req.maxTravelMin,
    ranked,
    excluded: excluded.map((e) => ({ ...e.view, travelMin: e.travelMin, reasons: e.reasons })),
    excludedWithoutConsent,
  };
}
