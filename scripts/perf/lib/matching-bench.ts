/**
 * Matching micro-benchmarks (no DB, @lanewise/matching): candidate ranking for
 * one store's open shift and the network-wide auto-match proposal, on the demo
 * network's cashiers (consented barangay home areas, a rostered peak week) and
 * a deterministic fake travel-time matrix; demo size and scaled to 27 stores.
 */
import { assignRoster, dateRange, planDepartmentDay, type AssignedShift, type Shift } from '@lanewise/domain';
import {
  FakeTravelTimeProvider,
  autoMatch,
  precomputeMatrix,
  rankCandidates,
  timeWindowOf,
  type MatchCandidate,
  type OpenShift,
  type WorkShift,
} from '@lanewise/matching';
import { metric, type Metric } from './metrics.js';
import { scaledNetwork, type NetworkFixture } from './network.js';
import { sample } from './stats.js';

const WEEK_FROM = '2026-12-14';
const WEEK_TO = '2026-12-20';
const PEAK_DAY = '2026-12-19';

interface MatchingFixture {
  readonly candidates: MatchCandidate[];
  readonly openShifts: OpenShift[];
  readonly oneStoreShift: OpenShift;
  readonly matrix: Awaited<ReturnType<typeof precomputeMatrix>>;
}

async function fixture(net: NetworkFixture): Promise<MatchingFixture> {
  const { ctx } = net;
  const storeOfDept = new Map(ctx.departments.map((d) => [d.id, d.storeId]));
  const assigned: AssignedShift[] = [];
  const open: Shift[] = [];
  for (const d of ctx.departments) {
    const shifts = dateRange(WEEK_FROM, WEEK_TO).flatMap((date) => planDepartmentDay(ctx, d.id, date).shifts);
    const r = assignRoster({ shifts, staff: net.staff.filter((s) => s.departmentId === d.id), rules: ctx.rules.labor });
    assigned.push(...r.assignments);
    open.push(...r.openShifts);
  }
  const byStaff = new Map<string, WorkShift[]>();
  for (const a of assigned) {
    const list = byStaff.get(a.staffId) ?? [];
    list.push({ shiftId: `${a.id}@${a.date}`, storeId: storeOfDept.get(a.departmentId) ?? '', date: a.date, startHour: a.start, endHour: a.end, paidHours: a.paidHours });
    byStaff.set(a.staffId, list);
  }
  const candidates: MatchCandidate[] = net.staff.map((s, i) => {
    const area = net.homeAreas.get(s.id);
    return {
      staffId: s.id,
      displayId: `XS-${i + 1}`,
      homeStoreId: s.storeId,
      contractType: s.contractType,
      skills: net.skills.get(s.id) ?? [s.departmentId],
      primaryDepartmentId: s.departmentId,
      location: area
        ? { homeArea: { barangay: area.barangay, city: area.city }, consentAt: '2026-06-01T01:00:00Z', maxTravelMin: area.maxTravelMin, crossStoreOffers: area.crossStoreOffers }
        : null,
      unavailableDates: s.unavailableDates,
      shifts: byStaff.get(s.id) ?? [],
      extraShiftsThisPeriod: i % 3,
      recentOffers: i % 2,
    };
  });
  // Open shifts on the peak day: the roster's unfilled shifts, else every 4th shift (a 25 % gap).
  let peakOpen = open.filter((s) => s.date === PEAK_DAY);
  if (peakOpen.length < ctx.departments.length) {
    peakOpen = ctx.departments.flatMap((d) => planDepartmentDay(ctx, d.id, PEAK_DAY).shifts.filter((_, i) => i % 4 === 0));
  }
  const openShifts: OpenShift[] = peakOpen.map((s) => ({
    shiftId: `${s.id}@${s.date}`,
    storeId: storeOfDept.get(s.departmentId) ?? '',
    departmentId: s.departmentId,
    date: s.date,
    startHour: s.start,
    endHour: s.end,
    paidHours: s.paidHours,
  }));
  const firstStore = ctx.stores[0]!.id;
  const oneStoreShift = openShifts.find((s) => s.storeId === firstStore) ?? openShifts[0]!;
  const areas = [...new Map([...net.homeAreas.values()].map((a) => [`${a.barangay}|${a.city}`, { barangay: a.barangay, city: a.city }])).values()];
  const matrix = await precomputeMatrix(new FakeTravelTimeProvider(), { homeAreas: areas, storeIds: ctx.stores.map((s) => s.id) });
  return { candidates, openShifts, oneStoreShift, matrix };
}

export async function matchingBenchmarks(opts: { runs: number; scaledAutoMatch: boolean; log: (s: string) => void }): Promise<Metric[]> {
  const out: Metric[] = [];
  for (const stores of [undefined, 27] as const) {
    const net = scaledNetwork(stores);
    const f = await fixture(net);
    const key = stores ? `scaled${stores}` : 'demo';
    const size = `${net.storeCount} stores, ${f.candidates.length} candidates`;
    opts.log(`matching: ${size}, ${f.openShifts.length} open shifts`);
    const shift = f.oneStoreShift;
    const req = { shift, mode: 'car' as const, maxTravelMin: 60, window: timeWindowOf(shift.date, Math.floor(shift.startHour)) };
    const rankRuns = Math.max(opts.runs, 50);
    out.push(
      metric(
        { id: `matching.${key}.rank_one_shift`, group: 'matching', name: `Rank candidates for one store’s open shift, ${size}`, reference: 'part of NFR-PERF-002 (500 ms)' },
        await sample(() => rankCandidates(req, f.candidates, f.matrix), rankRuns, 5),
      ),
    );
    // Auto-match grows super-linearly (~60 s per run at 27 stores): few runs, scaled only with --full.
    if (stores && !opts.scaledAutoMatch) continue;
    const autoRuns = stores ? 1 : Math.max(3, Math.min(opts.runs, 5));
    out.push(
      metric(
        {
          id: `matching.${key}.auto_match`,
          group: 'matching',
          name: `Network-wide auto-match, ${size}, ${f.openShifts.length} open shifts`,
          reference: 'part of the auto-match read',
        },
        await sample(() => autoMatch({ openShifts: f.openShifts, candidates: f.candidates, matrix: f.matrix, mode: 'car', maxTravelMin: 60 }), autoRuns, stores ? 0 : 1),
      ),
    );
  }
  return out;
}
