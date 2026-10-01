/**
 * Gaps and surplus from the task 14 network view (SCR-020; Req 5, 11.1).
 *
 * For the date, the PUBLISHED scenario of the map's provenance whose planning
 * window contains it, planned from its latest succeeded network run with the
 * same engine the network view uses (`networkDayFor`, so the figures agree,
 * P2). Per in-scope store × department in the day part:
 *   required = peak cashiers required (Erlang C + shrinkage) in the window;
 *   rostered = distinct cashiers on the published roster in the window, or —
 *              when no roster is published for that department — the
 *              scenario's planned shifts at that peak;
 *   surplus  = rostered − required when positive (spare cashiers to lend).
 * Open shifts (what offers and moves fill) always come from published rosters.
 * Without a published, run scenario for the date it answers with the
 * published-roster source.
 */
import { MAP_DAY_PART_HOURS } from '@lanewise/shared';
import type { Queryable } from '../db/pool.js';
import { departmentKey } from '../db/repositories/network-map.js';
import { contextForRun, loadPlanningBasis, networkDayFor, orgLookup, type PlanningBasis } from '../planning/basis.js';
import { publishedRosterGaps, type NetworkGapsSource, type StoreDepartmentGap } from './gaps.js';

/** The published scenario (of this provenance) planning `date`, with a succeeded run; or null. */
async function publishedBasisFor(db: Queryable, date: string, synthetic: boolean): Promise<PlanningBasis | null> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM scenario WHERE status = 'published' AND synthetic = $1 ORDER BY published_at DESC, id`,
    [synthetic],
  );
  for (const r of rows) {
    const basis = await loadPlanningBasis(db, r.id);
    const s = basis?.scenario.settings;
    if (basis?.run && s && date >= s.planningFrom && date <= s.planningTo) return basis;
  }
  return null;
}

export const networkViewGaps: NetworkGapsSource = {
  async gaps(db, q) {
    const roster = await publishedRosterGaps.gaps(db, q);
    if (q.storeIds.length === 0) return { kind: 'network_view', gaps: [] };
    const basis = await publishedBasisFor(db, q.date, q.synthetic);
    if (!basis?.run) return roster;

    const [from, to] = MAP_DAY_PART_HOURS[q.dayPart];
    const settings = basis.scenario.settings;
    const org = orgLookup(basis.orgRows, contextForRun(basis.run, settings));
    const day = networkDayFor(basis.run, settings, q.date);
    const inScope = new Set(q.storeIds);
    const fromRoster = new Map(roster.gaps.map((g) => [`${g.storeId}|${g.departmentKey}`, g]));
    const out = new Map<string, StoreDepartmentGap>();

    for (const plan of day.departments) {
      const dept = org.departmentFor(plan.departmentId);
      if (!dept || !inScope.has(dept.store.id)) continue;
      const key = departmentKey(dept.name);
      if (q.department !== undefined && key !== q.department) continue;
      const hours = plan.hours.filter((h) => h.hour >= from && h.hour < to);
      if (hours.length === 0) continue;
      const peak = hours.reduce((a, h) => (h.cashiersRequired > a.cashiersRequired ? h : a));
      const planned = plan.shifts.filter((s) => peak.hour >= s.start && peak.hour < s.end && s.mealHour !== peak.hour).length;
      const k = `${dept.store.id}|${key}`;
      const prev = out.get(k);
      const actual = fromRoster.get(k);
      const required = (prev?.required ?? 0) + peak.cashiersRequired;
      const rostered = actual ? actual.rostered : (prev?.rostered ?? 0) + planned;
      out.set(k, {
        storeId: dept.store.id,
        departmentKey: key,
        departmentName: dept.name,
        required,
        rostered,
        openShifts: actual?.openShifts ?? [],
        surplus: Math.max(0, rostered - required),
      });
    }
    // Rostered departments the scenario does not plan keep their roster figures.
    for (const [k, g] of fromRoster) if (!out.has(k)) out.set(k, g);
    const gaps = [...out.values()].sort((a, b) => (a.storeId < b.storeId ? -1 : a.storeId > b.storeId ? 1 : a.departmentKey < b.departmentKey ? -1 : 1));
    return { kind: 'network_view', gaps };
  },
};
