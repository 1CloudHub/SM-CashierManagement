/**
 * In-memory demo network for the no-DB benchmarks: the @lanewise/domain demo
 * planning context plus the API's demo dataset (staff, home areas, barangays),
 * optionally cloned up to N stores (the NFR-PERF-004 sizing assumes a
 * 27-store network; the shipped demo network has 8).
 */
import {
  demo,
  type Department,
  type PlanningContext,
  type StaffMember,
  type Store,
  type ContractType,
} from '@lanewise/domain';
import { buildDemoDataset, type DemoDataset } from '../../../api/src/db/demo/dataset.js';

export interface NetworkFixture {
  readonly ctx: PlanningContext;
  /** Domain staff (department ids are domain ids). */
  readonly staff: readonly StaffMember[];
  /** Matching inputs. */
  readonly homeAreas: ReadonlyMap<string, { barangay: string; city: string; maxTravelMin: number; crossStoreOffers: boolean }>;
  /** staff id → trained domain department ids */
  readonly skills: ReadonlyMap<string, readonly string[]>;
  readonly storeCount: number;
}

let base: { ctx: PlanningContext; data: DemoDataset } | null = null;

/** The demo context (history generation + model learning) and dataset, built once. */
export function baseNetwork(): { ctx: PlanningContext; data: DemoDataset } {
  base ??= { ctx: demo.createDemoContext(), data: buildDemoDataset() };
  return base;
}

const suffix = (id: string, k: number) => (k === 0 ? id : `${id}~${k}`);

/** The demo network with stores cloned (round-robin) until it has `stores` stores. */
export function scaledNetwork(stores?: number): NetworkFixture {
  const { ctx, data } = baseNetwork();
  const target = stores ?? ctx.stores.length;
  const deptDomain = new Map(data.departments.map((d) => [d.id, d.domainId]));
  const outStores: Store[] = [];
  const outDepts: Department[] = [];
  const models = new Map(ctx.models);
  const staff: StaffMember[] = [];
  const homeAreas = new Map<string, { barangay: string; city: string; maxTravelMin: number; crossStoreOffers: boolean }>();
  const skills = new Map<string, readonly string[]>();
  const barangays = new Map(data.barangays.map((b) => [b.psgcCode, b]));
  const areaByStaff = new Map(data.homeAreas.map((h) => [h.staffId, h]));
  const storeDomain = new Map(data.stores.map((s) => [s.id, s.domainId]));

  for (let i = 0; i < target; i += 1) {
    const k = Math.floor(i / ctx.stores.length);
    const s = ctx.stores[i % ctx.stores.length]!;
    outStores.push({ ...s, id: suffix(s.id, k), name: k === 0 ? s.name : `${s.name} #${k + 1}` });
    for (const d of ctx.departments.filter((x) => x.storeId === s.id)) {
      const id = suffix(d.id, k);
      outDepts.push({ ...d, id, storeId: suffix(s.id, k) });
      const m = ctx.models.get(d.id);
      if (m && k > 0) models.set(id, { ...m, departmentId: id });
    }
    for (const row of data.staff.filter((r) => storeDomain.get(r.storeId) === s.id)) {
      const id = suffix(row.id, k);
      const pattern = row.weeklyPattern as { contractType?: ContractType; preferredRestDay?: number };
      staff.push({
        id,
        name: row.name,
        storeId: suffix(s.id, k),
        departmentId: suffix(deptDomain.get(row.departmentId) ?? row.departmentId, k),
        contractType: pattern.contractType ?? 'FT',
        preferredRestDay: row.preferredRestDay,
        unavailableDates: [],
      });
      skills.set(
        id,
        row.trainedDepartmentIds.map((t) => suffix(deptDomain.get(t) ?? t, k)),
      );
      const area = areaByStaff.get(row.id);
      const b = area ? barangays.get(area.barangayCode) : undefined;
      if (area && b) homeAreas.set(id, { barangay: b.name, city: b.city, maxTravelMin: area.maxTravelMin, crossStoreOffers: area.crossStoreOffers });
    }
  }
  return {
    ctx: { ...ctx, stores: outStores, departments: outDepts, models },
    staff,
    homeAreas,
    skills,
    storeCount: outStores.length,
  };
}
