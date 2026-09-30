/**
 * Seasonal team sizing and hiring plan — DOM-001 "Team sizing" and "Hiring
 * plan" (spec Req 10.1):
 *
 * 1. Team sizing: per department, contract type and roster week, the
 *    headcount needed is the larger of (weekly paid hours ÷ contracted weekly
 *    hours) and (peak daily shifts × 7/6, since nobody works 7 days), plus the
 *    recruiting buffer; the season requirement is the peak week.
 * 2. Hiring waves: the gap to current staff is phased by the week each extra
 *    head is first needed, and each wave starts recruiting `leadTime` days
 *    before it is needed, with lead-time-driven milestones.
 */
import { addDays, weekStart } from './calendar.js';
import { safeCeil } from './lanes.js';
import type { HiringRuleVersion } from './rules.js';
import { CONTRACT_TYPES, type ContractType, type IsoDate, type Shift } from './types.js';

export interface DepartmentShiftsForDate {
  readonly storeId: string;
  readonly departmentId: string;
  readonly date: IsoDate;
  readonly shifts: readonly Shift[];
}

export interface WeeklyRequirement {
  readonly storeId: string;
  readonly departmentId: string;
  readonly contractType: ContractType;
  readonly weekStart: IsoDate;
  readonly paidHours: number;
  readonly peakDailyShifts: number;
  readonly headcount: number;
}

export interface TeamSize {
  readonly storeId: string;
  readonly departmentId: string;
  readonly contractType: ContractType;
  /** Peak-week headcount including the recruiting buffer. */
  readonly headcount: number;
  readonly peakWeek: IsoDate;
}

export interface CurrentStaffCount {
  readonly departmentId: string;
  readonly contractType: ContractType;
  readonly count: number;
}

export interface WaveLine {
  readonly storeId: string;
  readonly departmentId: string;
  readonly count: number;
}

export interface Milestone {
  readonly name: string;
  readonly date: IsoDate;
}

export interface HiringWave {
  readonly id: string;
  readonly contractType: ContractType;
  readonly needBy: IsoDate;
  readonly recruitStart: IsoDate;
  readonly total: number;
  readonly lines: readonly WaveLine[];
  readonly milestones: readonly Milestone[];
}

export interface HiringPlan {
  readonly teamSizes: readonly TeamSize[];
  readonly hiresByStoreAndRole: readonly { readonly storeId: string; readonly contractType: ContractType; readonly hires: number }[];
  readonly waves: readonly HiringWave[];
  readonly totalHires: number;
  readonly hiringRuleVersionId: string;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Weekly headcount requirement per department and contract type. */
export function weeklyRequirements(
  plans: readonly DepartmentShiftsForDate[],
  rules: HiringRuleVersion,
): WeeklyRequirement[] {
  interface Acc {
    storeId: string;
    departmentId: string;
    type: ContractType;
    week: IsoDate;
    hours: number;
    daily: Map<IsoDate, number>;
  }
  const acc = new Map<string, Acc>();
  for (const p of plans) {
    const week = weekStart(p.date);
    for (const type of CONTRACT_TYPES) {
      const key = `${p.departmentId}|${type}|${week}`;
      let a = acc.get(key);
      if (!a) {
        a = { storeId: p.storeId, departmentId: p.departmentId, type, week, hours: 0, daily: new Map() };
        acc.set(key, a);
      }
      const own = p.shifts.filter((s) => s.type === type);
      a.hours += own.reduce((s, x) => s + x.paidHours, 0);
      a.daily.set(p.date, (a.daily.get(p.date) ?? 0) + own.length);
    }
  }
  return [...acc.values()]
    .map((a) => {
      const peakDaily = Math.max(0, ...a.daily.values());
      const base = Math.max(a.hours / rules.contractWeeklyHours[a.type], (peakDaily * 7) / 6);
      return {
        storeId: a.storeId,
        departmentId: a.departmentId,
        contractType: a.type,
        weekStart: a.week,
        paidHours: a.hours,
        peakDailyShifts: peakDaily,
        headcount: base > 0 ? safeCeil(base * (1 + rules.recruitingBuffer)) : 0,
      };
    })
    .sort((x, y) => cmp(x.departmentId, y.departmentId) || cmp(x.contractType, y.contractType) || cmp(x.weekStart, y.weekStart));
}

/** Season team size: the peak-week headcount per department and contract type. */
export function sizeTeams(plans: readonly DepartmentShiftsForDate[], rules: HiringRuleVersion): TeamSize[] {
  const best = new Map<string, TeamSize>();
  for (const w of weeklyRequirements(plans, rules)) {
    const key = `${w.departmentId}|${w.contractType}`;
    const cur = best.get(key);
    if (!cur || w.headcount > cur.headcount) {
      best.set(key, {
        storeId: w.storeId,
        departmentId: w.departmentId,
        contractType: w.contractType,
        headcount: w.headcount,
        peakWeek: w.weekStart,
      });
    }
  }
  return [...best.values()].sort((x, y) => cmp(x.departmentId, y.departmentId) || cmp(x.contractType, y.contractType));
}

/** Build the hiring plan: team sizes, gaps to current staff and lead-time-phased waves. */
export function buildHiringPlan(
  plans: readonly DepartmentShiftsForDate[],
  current: readonly CurrentStaffCount[],
  rules: HiringRuleVersion,
): HiringPlan {
  const weekly = weeklyRequirements(plans, rules);
  const teamSizes = sizeTeams(plans, rules);
  const have = new Map(current.map((c) => [`${c.departmentId}|${c.contractType}`, c.count]));

  // Phase hires by the week they are first needed.
  const waveLines = new Map<string, { type: ContractType; needBy: IsoDate; lines: WaveLine[] }>();
  const series = new Map<string, WeeklyRequirement[]>();
  for (const w of weekly) {
    const key = `${w.departmentId}|${w.contractType}`;
    series.set(key, [...(series.get(key) ?? []), w]);
  }
  for (const key of [...series.keys()].sort()) {
    let covered = have.get(key) ?? 0;
    for (const w of series.get(key) ?? []) {
      if (w.headcount <= covered) continue;
      const count = w.headcount - covered;
      covered = w.headcount;
      const waveKey = `${w.contractType}|${w.weekStart}`;
      const wave = waveLines.get(waveKey) ?? { type: w.contractType, needBy: w.weekStart, lines: [] };
      wave.lines.push({ storeId: w.storeId, departmentId: w.departmentId, count });
      waveLines.set(waveKey, wave);
    }
  }

  const waves: HiringWave[] = [...waveLines.values()]
    .sort((a, b) => cmp(a.needBy, b.needBy) || cmp(a.type, b.type))
    .map((w) => ({
      id: `wave-${w.type.toLowerCase()}-${w.needBy}`,
      contractType: w.type,
      needBy: w.needBy,
      recruitStart: addDays(w.needBy, -rules.leadTimeDays[w.type]),
      total: w.lines.reduce((s, l) => s + l.count, 0),
      lines: [...w.lines].sort((a, b) => cmp(a.departmentId, b.departmentId)),
      milestones: rules.milestones.map((m) => ({ name: m.name, date: addDays(w.needBy, -m.daysBeforeNeedBy[w.type]) })),
    }));

  const byStoreRole = new Map<string, { storeId: string; contractType: ContractType; hires: number }>();
  for (const w of waves) {
    for (const l of w.lines) {
      const key = `${l.storeId}|${w.contractType}`;
      const cur = byStoreRole.get(key) ?? { storeId: l.storeId, contractType: w.contractType, hires: 0 };
      cur.hires += l.count;
      byStoreRole.set(key, cur);
    }
  }
  const hiresByStoreAndRole = [...byStoreRole.values()].sort(
    (a, b) => cmp(a.storeId, b.storeId) || cmp(a.contractType, b.contractType),
  );

  return {
    teamSizes,
    hiresByStoreAndRole,
    waves,
    totalHires: waves.reduce((s, w) => s + w.total, 0),
    hiringRuleVersionId: rules.id,
  };
}
