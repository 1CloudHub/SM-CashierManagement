/**
 * Network / department / hiring contracts (task 14; Req 5, 10; P1, P2, P9).
 *
 * P2 (single-department vs all-stores identical figures): a department's row
 * in the aggregated network view is exactly `departmentFigures` of its
 * department-day, however the network is filtered, and store / network
 * totals are sums of those rows.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  SAMPLE_DATA_MARKER,
  aggregateNetwork,
  departmentDayCsv,
  departmentFigures,
  hiringKpisFor,
  matchesNetworkFilter,
  milestoneStatus,
  networkViewCsv,
  offersDueOf,
  scheduledByHour,
  type DepartmentDayInput,
  type HiringStoreRow,
  type NetworkView,
  type PlanningProvenance,
} from '../src/index.js';

const hourArb = fc
  .tuple(fc.integer({ min: 6, max: 11 }), fc.integer({ min: 8, max: 15 }))
  .map(([open, len]) => Array.from({ length: len }, (_, i) => open + i));

const departmentArb = (storeId: string, index: number): fc.Arbitrary<DepartmentDayInput> =>
  fc
    .record({
      installed: fc.integer({ min: 2, max: 40 }),
      hours: hourArb,
      needs: fc.array(fc.integer({ min: 0, max: 50 }), { minLength: 15, maxLength: 15 }),
      shifts: fc.array(fc.record({ type: fc.constantFrom('FT' as const, 'PT' as const, 'FLOAT' as const), paidHours: fc.integer({ min: 4, max: 8 }) }), { maxLength: 30 }),
      tx: fc.integer({ min: 0, max: 9000 }),
      cost: fc.double({ min: 0, max: 50_000, noNaN: true }),
      region: fc.constantFrom('r-luzon', 'r-visayas'),
      format: fc.constantFrom('sm_supermarket', 'savemore'),
    })
    .map((r) => ({
      departmentId: `${storeId}-d${index}`,
      departmentName: `Dept ${index}`,
      storeId,
      storeName: `Store ${storeId}`,
      regionId: r.region,
      storeFormat: r.format,
      installedLanes: r.installed,
      forecastTransactions: r.tx,
      hours: r.hours.map((hour, i) => {
        const need = r.needs[i] ?? 0;
        const open = Math.min(need, r.installed);
        return { hour, lanesNeeded: need, lanesOpen: open, cashiersRequired: Math.ceil(open * 1.17), overCapacity: need > r.installed };
      }),
      shifts: r.shifts,
      cost: r.cost,
    }));

/** A network: 1–4 stores of 1–4 departments; departments of a store share its region and format. */
const networkArb: fc.Arbitrary<DepartmentDayInput[]> = fc
  .array(fc.integer({ min: 1, max: 4 }), { minLength: 1, maxLength: 4 })
  .chain((counts) =>
    fc.tuple(...counts.map((n, s) => fc.tuple(...Array.from({ length: n }, (_, d) => departmentArb(`s${s}`, d))))),
  )
  .map((stores) =>
    stores.flatMap((depts) => depts.map((d) => ({ ...d, regionId: depts[0]?.regionId ?? d.regionId, storeFormat: depts[0]?.storeFormat ?? d.storeFormat }))),
  );

describe('P2 — single-department and all-stores views show identical figures', () => {
  it('every department row of the network equals its standalone figures, under any filter', () => {
    fc.assert(
      fc.property(networkArb, fc.record({ regionId: fc.constantFrom('', 'r-luzon', 'r-visayas'), storeFormat: fc.constantFrom('', 'savemore') }), (inputs, filter) => {
        const all = inputs.map(departmentFigures);
        const shown = all.filter((r) => matchesNetworkFilter(r, filter));
        const net = aggregateNetwork(shown);
        for (const store of net.stores) {
          for (const row of store.departments) {
            const input = inputs.find((i) => i.departmentId === row.departmentId) as DepartmentDayInput;
            expect(row).toEqual(departmentFigures(input));
          }
          // Store totals are sums of their department rows.
          expect(store.cashiers).toBe(store.departments.reduce((n, d) => n + d.cashiers, 0));
          expect(store.paidHours).toBe(store.departments.reduce((n, d) => n + d.paidHours, 0));
          expect(store.forecastTransactions).toBe(store.departments.reduce((n, d) => n + d.forecastTransactions, 0));
          expect(store.cost).toBeCloseTo(store.departments.reduce((n, d) => n + d.cost, 0), 1);
          expect(store.peakLanes).toBe(Math.max(0, ...store.lanesByHour.map((h) => h.lanesOpen)));
        }
        expect(net.kpis.departments).toBe(shown.length);
        expect(net.kpis.cashiers).toBe(shown.reduce((n, d) => n + d.cashiers, 0));
        expect(net.kpis.overCapacityDepartments).toBe(shown.filter((d) => d.overCapacityHours.length > 0).length);
      }),
      { numRuns: 200 },
    );
  });

  it('a one-department network has exactly that department’s peak, cashiers and hours', () => {
    fc.assert(
      fc.property(departmentArb('s0', 0), (input) => {
        const f = departmentFigures(input);
        const net = aggregateNetwork([f]);
        expect(net.kpis.peakLanes).toBe(f.peakLanes);
        expect(net.kpis.peakHour).toBe(f.peakHour);
        expect(net.kpis.cashiers).toBe(f.cashiers);
        expect(net.kpis.paidHours).toBe(f.paidHours);
        expect(net.stores[0]?.peakLanes).toBe(f.peakLanes);
      }),
      { numRuns: 200 },
    );
  });

  it('flags over-capacity hours and pressure as a share of installed lanes', () => {
    const f = departmentFigures({
      departmentId: 'd',
      departmentName: 'Main',
      storeId: 's',
      storeName: 'S',
      regionId: 'r',
      storeFormat: 'f',
      installedLanes: 24,
      forecastTransactions: 2980,
      hours: [
        { hour: 16, lanesNeeded: 22, lanesOpen: 22, cashiersRequired: 26, overCapacity: false },
        { hour: 17, lanesNeeded: 26, lanesOpen: 24, cashiersRequired: 29, overCapacity: true },
      ],
      shifts: [{ type: 'FT', paidHours: 8 }],
      cost: 1234.567,
    });
    expect(f.overCapacityHours).toEqual([17]);
    expect(f.maxLanesNeeded).toBe(26);
    expect(f.hours.map((h) => h.pressurePct)).toEqual([92, 108]);
    expect(f.peakLanes).toBe(24);
    expect(f.cost).toBe(1234.57);
  });
});

const provenance: PlanningProvenance = {
  scenarioId: 'scn',
  scenarioName: 'Christmas 2026',
  scenarioStatus: 'published',
  runId: 'run-1',
  runAt: '2026-09-10T06:00:00.000Z',
  snapshotIds: { pos: 'snap-pos', master: 'snap-master' },
  ruleVersionIds: ['rv-2', 'rv-1'],
  synthetic: true,
  stale: false,
};

describe('exports carry provenance and the sample-data marker (P9)', () => {
  const figures = departmentFigures({
    departmentId: 'd',
    departmentName: 'Main, lanes',
    storeId: 's',
    storeName: 'QC',
    regionId: 'r',
    storeFormat: 'f',
    installedLanes: 10,
    forecastTransactions: 100,
    hours: [{ hour: 9, lanesNeeded: 3, lanesOpen: 3, cashiersRequired: 4, overCapacity: false }],
    shifts: [{ type: 'PT', paidHours: 4 }],
    cost: 500,
  });
  const agg = aggregateNetwork([figures]);
  const view: NetworkView = { provenance, date: '2026-12-19', dayType: 'regular', hours: agg.hours, kpis: agg.kpis, stores: agg.stores };

  it('network CSV: marker first, header block, store and department rows, cost only when present', () => {
    const csv = networkViewCsv(view, { generatedAt: 't', generatedBy: 'pln@smretail.com', filters: 'region=r' });
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(SAMPLE_DATA_MARKER);
    expect(csv).toContain('Scenario,Christmas 2026 (published)');
    expect(csv).toContain('Rules versions,rv-1 rv-2');
    expect(csv).toContain('Data snapshots,master:snap-master pos:snap-pos');
    expect(csv).toContain('QC,"Main, lanes",100,3,9,10,1,4,500.00,0');
    const hidden = JSON.parse(JSON.stringify(view, (key: string, value: unknown) => (key === 'cost' ? undefined : value))) as NetworkView;
    expect(networkViewCsv(hidden, { generatedAt: 't', generatedBy: 'x', filters: '' })).not.toContain('Cost PHP');
  });

  it('real data carries no marker', () => {
    const csv = networkViewCsv({ ...view, provenance: { ...provenance, synthetic: false } }, { generatedAt: 't', generatedBy: 'x', filters: '' });
    expect(csv.startsWith(SAMPLE_DATA_MARKER)).toBe(false);
  });

  it('department CSV lists every hour with scheduled cashiers excluding the meal hour', () => {
    const shifts = [
      { id: 'a', type: 'FT' as const, start: 9, end: 18, mealHour: 13, paidHours: 8 },
      { id: 'b', type: 'PT' as const, start: 12, end: 16, mealHour: null, paidHours: 4 },
    ];
    expect(scheduledByHour(shifts, [9, 12, 13, 16])).toEqual([1, 2, 1, 1]);
    const csv = departmentDayCsv(
      {
        provenance,
        date: '2026-12-19',
        dayType: 'regular',
        serviceTarget: { serviceLevel: 0.9, thresholdSec: 60 },
        shrinkage: 0.17,
        figures,
        hours: [{ hour: 13, transactions: 339, erlangs: 14.1, lanesNeeded: 19, lanesOpen: 19, cashiersRequired: 23, scheduled: 1, utilization: 0.74, serviceLevel: 0.92, avgWaitSec: 10, overCapacity: false }],
        shifts,
      },
      { generatedAt: 't', generatedBy: 'x', filters: '' },
    );
    expect(csv).toContain('13,339.0,14.10,19,19,23,1,74,92,10,no');
  });
});

describe('hiring plan helpers', () => {
  it('milestone status: overdue before today, due soon within 7 days, else upcoming', () => {
    expect(milestoneStatus('2026-09-30', '2026-10-01')).toBe('overdue');
    expect(milestoneStatus('2026-10-01', '2026-10-01')).toBe('due_soon');
    expect(milestoneStatus('2026-10-08', '2026-10-01')).toBe('due_soon');
    expect(milestoneStatus('2026-10-09', '2026-10-01')).toBe('upcoming');
    expect(milestoneStatus('2026-09-01', '2026-10-01', true)).toBe('done');
  });

  it('KPIs and waves count in-scope stores only (P1)', () => {
    const store = (id: string, hires: number): HiringStoreRow & { cost: number } => ({
      storeId: id,
      storeName: id,
      regionId: 'r',
      baseline: 10,
      season: 10 + hires,
      hires,
      hiresByType: { FT: hires, PT: 0, FLOAT: 0 },
      neededBy: '2026-11-02',
      busiestWeek: '2026-12-14',
      shifts: 5,
      paidHours: 40,
      cost: 100,
      departments: [],
    });
    const waves = [
      { needBy: '2026-11-02', recruitStart: '2026-09-21', storeIds: ['b'] },
      { needBy: '2026-11-09', recruitStart: '2026-10-12', storeIds: ['a'] },
    ];
    const k = hiringKpisFor([store('a', 3)], waves);
    expect(k).toMatchObject({ seasonalHires: 3, baselineTeam: 10, peakTeam: 13, firstNeededBy: '2026-11-09', recruitFrom: '2026-10-12', seasonCost: 100 });
    expect(offersDueOf([
      { date: '2026-10-12', name: 'Offers accepted', contractType: 'FT', count: 1, waveId: 'w', status: 'upcoming' },
      { date: '2026-10-05', name: 'Offers accepted', contractType: 'PT', count: 1, waveId: 'w2', status: 'upcoming' },
    ])).toBe('2026-10-05');
  });
});
