/**
 * Shift construction — DOM-001 "Shift construction" (v3 shift builder):
 *
 * 1. FT shifts for the base load (one unpaid 1-hour meal per FT shift, placed
 *    in the hour with most spare cover inside its allowed window);
 * 2. float cashiers for the sustained peak (full-length, no meal);
 * 3. PT shifts for the remaining short peaks — or relief FT shifts when
 *    part-time is not allowed — until no hour is short.
 *
 * Shifts start on the hour (v3 limitation, preserved).
 *
 * Deterministic: every choice has a total tie-break order, so the same
 * requirement curve always yields the same shift set.
 */
import type { ShiftRules } from './rules.js';
import type { ContractType, Hour, IsoDate, Shift } from './types.js';

export interface HourlyRequirement {
  readonly hour: Hour;
  readonly cashiersRequired: number;
}

export interface ShiftBuildInput {
  readonly departmentId: string;
  readonly date: IsoDate;
  /** Contiguous trading hours, ascending. */
  readonly requirement: readonly HourlyRequirement[];
  readonly rules: ShiftRules;
  readonly allowPartTime: boolean;
}

interface Window {
  readonly start: number;
  readonly length: number;
  readonly useful: number;
  readonly deficit: number;
}

/** Better window: more useful hours, then shorter, then more deficit, then earlier. */
function better(a: Window, b: Window | null): boolean {
  if (b === null) return true;
  if (a.useful !== b.useful) return a.useful > b.useful;
  if (a.length !== b.length) return a.length < b.length;
  if (a.deficit !== b.deficit) return a.deficit > b.deficit;
  return a.start < b.start;
}

function bestWindow(need: readonly number[], cover: readonly number[], minLen: number, maxLen: number): Window | null {
  const n = need.length;
  let best: Window | null = null;
  for (let len = Math.min(minLen, n); len <= Math.min(maxLen, n); len += 1) {
    for (let s = 0; s + len <= n; s += 1) {
      let useful = 0;
      let deficit = 0;
      for (let i = s; i < s + len; i += 1) {
        const d = (need[i] ?? 0) - (cover[i] ?? 0);
        if (d > 0) {
          useful += 1;
          deficit += d;
        }
      }
      const w: Window = { start: s, length: len, useful, deficit };
      if (better(w, best)) best = w;
    }
  }
  return best;
}

export function buildShifts(input: ShiftBuildInput): Shift[] {
  const { requirement, rules } = input;
  const n = requirement.length;
  if (n === 0) return [];
  const open = requirement[0]?.hour ?? 0;
  const need = requirement.map((r) => r.cashiersRequired);
  const cover = new Array<number>(n).fill(0);
  const shifts: Shift[] = [];
  const seq: Record<ContractType, number> = { FT: 0, PT: 0, FLOAT: 0 };

  const push = (type: ContractType, start: number, length: number, mealIdx: number | null): void => {
    seq[type] += 1;
    const mealHours = mealIdx === null ? 0 : rules.ftMealHours;
    shifts.push({
      id: `${input.departmentId}:${input.date}:${type}:${String(seq[type]).padStart(3, '0')}`,
      departmentId: input.departmentId,
      date: input.date,
      type,
      start: open + start,
      end: open + start + length,
      mealHour: mealIdx === null ? null : open + mealIdx,
      paidHours: length - mealHours,
    });
  };

  const hasDeficit = (): boolean => need.some((v, i) => v > (cover[i] ?? 0));

  const placeFt = (minUseful: number): boolean => {
    const span = rules.ftSpanHours;
    if (n < span) return false;
    const w = bestWindow(need, cover, span, span);
    if (!w || w.useful < minUseful || w.useful === 0) return false;
    for (let i = w.start; i < w.start + span; i += 1) cover[i] = (cover[i] ?? 0) + 1;
    // Meal: hour with most spare cover inside the allowed window (ties → earliest).
    const lo = w.start + rules.mealWindow.earliestOffset;
    const hi = Math.min(w.start + rules.mealWindow.latestOffset, w.start + span - 1);
    let meal = lo;
    let bestSpare = Number.NEGATIVE_INFINITY;
    for (let i = lo; i <= hi; i += 1) {
      const spare = (cover[i] ?? 0) - (need[i] ?? 0);
      if (spare > bestSpare) {
        bestSpare = spare;
        meal = i;
      }
    }
    cover[meal] = (cover[meal] ?? 0) - 1;
    push('FT', w.start, span, meal);
    return true;
  };

  const placeShort = (type: 'PT' | 'FLOAT', minLen: number, maxLen: number, minUseful: number): boolean => {
    const w = bestWindow(need, cover, minLen, maxLen);
    if (!w || w.useful < Math.max(1, minUseful)) return false;
    for (let i = w.start; i < w.start + w.length; i += 1) cover[i] = (cover[i] ?? 0) + 1;
    push(type, w.start, w.length, null);
    return true;
  };

  // 1. FT base load.
  while (hasDeficit() && placeFt(rules.ftMinUsefulHours));
  // 2. Float cashiers around the sustained peak.
  while (hasDeficit() && placeShort('FLOAT', rules.floatMinHours, rules.floatMaxHours, rules.floatMinUsefulHours));
  // 3. PT for short peaks, or relief FT shifts when part-time is not allowed.
  if (input.allowPartTime) {
    while (hasDeficit() && placeShort('PT', rules.ptMinHours, rules.ptMaxHours, rules.ptMinUsefulHours));
  } else {
    while (hasDeficit() && placeFt(rules.reliefMinUsefulHours));
  }
  // 4. Safety net (FT-only residue, very short trading days): floats of at
  //    least the minimum short-shift length close any gap left.
  while (hasDeficit() && placeShort('FLOAT', rules.ptMinHours, rules.floatMaxHours, 1));

  return shifts;
}

/** Cashiers on the floor per hour (meal hours excluded). */
export function coverageOf(shifts: readonly Shift[], hours: readonly Hour[]): number[] {
  return hours.map(
    (h) => shifts.filter((s) => s.start <= h && h < s.end && s.mealHour !== h).length,
  );
}

/** Canonical key of a shift for shift-set comparisons (ignores ids and names). */
export function shiftKey(s: Shift): string {
  return `${s.departmentId}|${s.date}|${s.type}|${s.start}-${s.end}|meal:${s.mealHour ?? '-'}`;
}

export interface ShiftSummary {
  readonly count: number;
  readonly paidHours: number;
  readonly byType: Readonly<Record<ContractType, { readonly count: number; readonly paidHours: number }>>;
}

export function summarizeShifts(shifts: readonly Shift[]): ShiftSummary {
  const byType: Record<ContractType, { count: number; paidHours: number }> = {
    FT: { count: 0, paidHours: 0 },
    PT: { count: 0, paidHours: 0 },
    FLOAT: { count: 0, paidHours: 0 },
  };
  let paid = 0;
  for (const s of shifts) {
    byType[s.type].count += 1;
    byType[s.type].paidHours += s.paidHours;
    paid += s.paidHours;
  }
  return { count: shifts.length, paidHours: paid, byType };
}

/** Sum shift summaries (e.g. departments → store → network). */
export function mergeShiftSummaries(summaries: readonly ShiftSummary[]): ShiftSummary {
  const out = { count: 0, paidHours: 0, byType: { FT: { count: 0, paidHours: 0 }, PT: { count: 0, paidHours: 0 }, FLOAT: { count: 0, paidHours: 0 } } };
  for (const s of summaries) {
    out.count += s.count;
    out.paidHours += s.paidHours;
    for (const t of ['FT', 'PT', 'FLOAT'] as const) {
      out.byType[t].count += s.byType[t].count;
      out.byType[t].paidHours += s.byType[t].paidHours;
    }
  }
  return out;
}
