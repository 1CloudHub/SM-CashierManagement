/**
 * Network map, store candidates and auto-match (task 16.1, 16.4; Req 11, 12;
 * P1, P15, P16, P18). Composes the repository reads with `@lanewise/matching`
 * (ranking/eligibility 16.3, auto-match) — no matching logic lives here.
 *
 * Every response passes `assertNetworkMapPrivacy` (P15) before it is returned.
 */
import {
  DEFAULT_PT_SPEED_FACTOR,
  TravelTimeMatrix,
  autoMatch,
  homeAreaId,
  rankCandidates,
  ringBand,
  timeWindowOf,
  type ExcludedCandidate,
  type MatchResult,
  type OpenShift,
  type RankedCandidate,
  type SurplusSupply,
  type TimeWindowId,
  type TravelTimeEntry,
} from '@lanewise/matching';
import {
  MAP_DAY_PART_HOURS,
  MAP_RING_MINUTES,
  assertNetworkMapPrivacy,
  staffingStatus,
  type AutoMatchResponse,
  type GapsSourceKind,
  type ExcludedMapCandidate,
  type MapCandidate,
  type MapStorePin,
  type NetworkMapQuery,
  type NetworkMapResponse,
  type RankedMapCandidate,
  type Scope,
  type StoreCandidatesResponse,
  type TravelSource,
} from '@lanewise/shared';
import type { Queryable } from '../db/pool.js';
import * as repo from '../db/repositories/network-map.js';
import type { NetworkGapsSource, StoreDepartmentGap } from './gaps.js';

/** Straight-line fallback: Metro Manila average car speed (km/h) and road detour factor. */
export const STRAIGHT_LINE_CAR_KMH = 20;
export const STRAIGHT_LINE_DETOUR = 1.3;

export function straightLineMinutes(km: number, mode: NetworkMapQuery['mode']): number {
  const car = (km * STRAIGHT_LINE_DETOUR * 60) / STRAIGHT_LINE_CAR_KMH;
  return Math.max(1, Math.ceil(mode === 'car' ? car : car * DEFAULT_PT_SPEED_FACTOR));
}

/** Rounds away float noise (e.g. 31.750000000000004), which the P15 guard would read as a coordinate. */
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The matrix window a day part maps to on `date`. */
export function windowOf(query: Pick<NetworkMapQuery, 'date' | 'dayPart'>): TimeWindowId {
  return timeWindowOf(query.date, MAP_DAY_PART_HOURS[query.dayPart][0]);
}

interface Loaded {
  readonly synthetic: boolean;
  readonly kind: GapsSourceKind;
  readonly stores: readonly repo.MapStoreRecord[];
  readonly gaps: readonly StoreDepartmentGap[];
}

async function load(db: Queryable, scope: Scope, query: NetworkMapQuery, source: NetworkGapsSource): Promise<Loaded> {
  const synthetic = await repo.mapProvenance(db, scope);
  const stores = await repo.listMapStores(db, scope, { synthetic, ...(query.formats ? { formats: query.formats } : {}) });
  const result = await source.gaps(db, {
    date: query.date,
    dayPart: query.dayPart,
    storeIds: stores.map((s) => s.id),
    synthetic,
    ...(query.department !== undefined ? { department: query.department } : {}),
  });
  // Defence in depth: never report a gap for a store outside the caller's list (P1).
  const ids = new Set(stores.map((s) => s.id));
  return { synthetic, kind: result.kind, stores, gaps: result.gaps.filter((g) => ids.has(g.storeId)) };
}

function toPin(store: repo.MapStoreRecord, gaps: readonly StoreDepartmentGap[]): MapStorePin {
  const mine = gaps.filter((g) => g.storeId === store.id);
  const required = mine.reduce((a, g) => a + g.required, 0);
  const rostered = mine.reduce((a, g) => a + g.rostered, 0);
  const surplus = mine.reduce((a, g) => a + g.surplus, 0);
  // A surplus the source reports explicitly wins over rostered − required.
  const { status, delta } = surplus > 0 && required >= rostered ? { status: 'surplus' as const, delta: surplus } : staffingStatus(required, rostered);
  return {
    storeId: store.id,
    code: store.code,
    name: store.name,
    format: store.format,
    site: store.site,
    required,
    rostered,
    delta,
    status,
    openShifts: mine.reduce((a, g) => a + g.openShifts.length, 0),
  };
}

/** `GET /network-map` */
export async function networkMap(db: Queryable, scope: Scope, query: NetworkMapQuery, source: NetworkGapsSource): Promise<NetworkMapResponse> {
  const { synthetic, kind, stores, gaps } = await load(db, scope, query, source);
  const [layer, departments] = await Promise.all([repo.countConsentedByBarangay(db, synthetic), repo.listDepartmentOptions(db, stores.map((s) => s.id))]);
  return assertNetworkMapPrivacy({
    query,
    rings: [...MAP_RING_MINUTES[query.mode]],
    gapsSource: kind,
    stores: stores.map((s) => toPin(s, gaps)),
    staffLayer: layer.map((b) => ({ barangay: { code: b.code, name: b.name, city: b.city }, count: b.count })),
    departments,
  });
}

/**
 * The travel matrix for the candidates' barangays → `storeIds`: precomputed
 * minutes where present, straight-line estimates for the rest.
 */
export async function travelMatrix(
  db: Queryable,
  candidates: readonly repo.CandidateRecord[],
  storeIds: readonly string[],
  query: NetworkMapQuery,
  window: TimeWindowId,
): Promise<{ matrix: TravelTimeMatrix; source: TravelSource }> {
  const codes = [...new Set(candidates.map((c) => c.barangayCode))];
  const [cells, km] = await Promise.all([
    repo.listTravelTimes(db, { barangayCodes: codes, storeIds, mode: query.mode, window }),
    repo.barangayStoreKm(db, { barangayCodes: codes, storeIds }),
  ]);
  const entries = new Map<string, TravelTimeEntry>();
  const put = (barangay: string, city: string, storeId: string, minutes: number) => {
    const id = homeAreaId({ barangay, city });
    const k = `${id}|${storeId}`;
    if (!entries.has(k)) entries.set(k, { homeAreaId: id, storeId, mode: query.mode, window, minutes, computedAt: '' });
  };
  for (const c of cells) put(c.barangay, c.city, c.storeId, c.minutes);
  const fromMatrix = entries.size;
  for (const k of km) put(k.barangay, k.city, k.storeId, straightLineMinutes(k.km, query.mode));
  const source: TravelSource = entries.size > fromMatrix ? 'straight_line' : 'matrix';
  return { matrix: TravelTimeMatrix.fromEntries(entries.values()), source };
}

function baseCandidate(c: RankedCandidate | ExcludedCandidate, names: ReadonlyMap<string, string>, mode: NetworkMapQuery['mode']): MapCandidate {
  return {
    staffId: c.staffId,
    displayId: c.displayId,
    homeStoreId: c.homeStoreId,
    homeStoreName: names.get(c.homeStoreId) ?? '',
    homeArea: { barangay: c.homeArea.barangay, city: c.homeArea.city },
    travelMin: c.travelMin,
    ringBand: c.travelMin === null ? null : ringBand(mode, c.travelMin),
  };
}

function toRanked(c: RankedCandidate, names: ReadonlyMap<string, string>, mode: NetworkMapQuery['mode']): RankedMapCandidate {
  return {
    ...baseCandidate(c, names, mode),
    rank: c.rank,
    travelMin: c.travelMin,
    weeklyHours: { withShift: round2(c.weeklyHours.withShift), limit: c.weeklyHours.limit, headroom: round2(c.weeklyHours.headroom) },
    flags: [...c.flags],
  };
}

function toOpenShift(storeId: string, g: StoreDepartmentGap, slot: StoreDepartmentGap['openShifts'][number]): OpenShift {
  return { shiftId: slot.shiftId, storeId, departmentId: g.departmentKey, date: slot.date, startHour: slot.startHour, endHour: slot.endHour };
}

/** `GET /network-map/stores/:storeId/candidates`; null when the store is not on the caller's map. */
export async function storeCandidates(
  db: Queryable,
  scope: Scope,
  storeId: string,
  query: NetworkMapQuery,
  source: NetworkGapsSource,
): Promise<StoreCandidatesResponse | null> {
  // A store is addressed directly here, so the format filter does not apply.
  const { formats: _formats, ...unfiltered } = query;
  void _formats;
  const { synthetic, stores, gaps } = await load(db, scope, unfiltered, source);
  const store = stores.find((s) => s.id === storeId);
  if (!store) return null;
  const window = windowOf(query);
  const mine = gaps.filter((g) => g.storeId === storeId);
  const first = mine.flatMap((g) => g.openShifts.map((slot) => toOpenShift(storeId, g, slot))).sort((a, b) => a.startHour - b.startHour || (a.shiftId < b.shiftId ? -1 : 1))[0];

  const lenders = gaps.filter((g) => g.surplus > 0 && g.storeId !== storeId && (first === undefined || g.departmentKey === first.departmentId));
  const kmStores = await repo.storeStoreKm(db, [storeId, ...new Set(lenders.map((g) => g.storeId))]);
  const nearbySurplus = lenders
    .map((g) => {
      const km = kmStores.get(`${g.storeId}|${storeId}`);
      return km === undefined ? null : { storeId: g.storeId, name: stores.find((s) => s.id === g.storeId)?.name ?? '', surplus: g.surplus, travelMin: straightLineMinutes(km, query.mode) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null && x.travelMin <= query.maxTravelMin)
    .sort((a, b) => a.travelMin - b.travelMin || (a.storeId < b.storeId ? -1 : 1));

  let ranked: RankedMapCandidate[] = [];
  let excluded: ExcludedMapCandidate[] = [];
  let excludedWithoutConsent = 0;
  let travelSource: TravelSource = 'matrix';
  if (first) {
    const candidates = await repo.listMatchCandidates(db, { synthetic, date: query.date });
    const t = await travelMatrix(db, candidates, [storeId], query, window);
    travelSource = t.source;
    const result = rankCandidates({ shift: first, mode: query.mode, maxTravelMin: query.maxTravelMin, window }, candidates, t.matrix);
    const names = await repo.storeNames(db, [...new Set(candidates.map((c) => c.homeStoreId))]);
    ranked = result.ranked.map((c) => toRanked(c, names, query.mode));
    // Show near misses only (within reach but ineligible), never the whole network.
    excluded = result.excluded
      .filter((c) => c.travelMin !== null && c.travelMin <= query.maxTravelMin)
      .map((c) => ({ ...baseCandidate(c, names, query.mode), reasons: c.reasons.map((r) => r.code) }));
    excludedWithoutConsent = result.excludedWithoutConsent;
  }
  return assertNetworkMapPrivacy({
    query,
    store: toPin(store, gaps),
    shift: first ? { shiftId: first.shiftId, departmentKey: first.departmentId, date: first.date, startHour: first.startHour, endHour: first.endHour } : null,
    travelSource,
    ranked,
    excluded,
    excludedWithoutConsent,
    nearbySurplus,
  });
}

/** `GET /network-map/auto-match` — a proposal for review; nothing is created or sent. */
export async function autoMatchProposal(db: Queryable, scope: Scope, query: NetworkMapQuery, source: NetworkGapsSource): Promise<AutoMatchResponse> {
  const { synthetic, kind, stores, gaps } = await load(db, scope, query, source);
  const window = windowOf(query);
  const openShifts = gaps.flatMap((g) => g.openShifts.map((slot) => toOpenShift(g.storeId, g, slot)));
  const surplus: SurplusSupply[] = gaps
    .filter((g) => g.surplus > 0)
    .map((g) => ({ storeId: g.storeId, departmentId: g.departmentKey, date: query.date, window, count: g.surplus }));
  const storeIds = stores.map((s) => s.id);
  const candidates = openShifts.length > 0 ? await repo.listMatchCandidates(db, { synthetic, date: query.date }) : [];
  const [{ matrix, source: travelSource }, kmStores] = await Promise.all([
    travelMatrix(db, candidates, [...new Set(openShifts.map((s) => s.storeId))], query, window),
    repo.storeStoreKm(db, surplus.length > 0 ? storeIds : []),
  ]);
  const proposal = autoMatch({
    openShifts,
    candidates,
    matrix,
    surplus,
    storeTravel: (from, to, mode) => {
      const km = kmStores.get(`${from}|${to}`);
      return km === undefined ? undefined : straightLineMinutes(km, mode);
    },
    mode: query.mode,
    maxTravelMin: query.maxTravelMin,
  });
  const names = await repo.storeNames(db, [...new Set([...storeIds, ...candidates.map((c) => c.homeStoreId)])]);
  const name = (id: string) => names.get(id) ?? '';
  return assertNetworkMapPrivacy({
    query,
    gapsSource: kind,
    travelSource: candidates.length === 0 ? 'matrix' : travelSource,
    offers: proposal.offers.map((o) => ({
      shiftId: o.shiftId,
      storeId: o.storeId,
      storeName: name(o.storeId),
      departmentKey: o.departmentId,
      date: o.date,
      startHour: o.startHour,
      endHour: o.endHour,
      travelMin: o.travelMin,
      candidate: toRanked(o.candidate, names, query.mode),
    })),
    moves: proposal.moves.map((m) => ({
      fromStoreId: m.fromStoreId,
      fromStoreName: name(m.fromStoreId),
      toStoreId: m.toStoreId,
      toStoreName: name(m.toStoreId),
      departmentKey: m.departmentId,
      date: m.date,
      count: m.count,
      travelMin: m.travelMin,
      shiftIds: [...m.shiftIds],
    })),
    unfilled: proposal.unfilled.map((u) => ({ shiftId: u.shiftId, storeId: u.storeId, storeName: name(u.storeId), departmentKey: u.departmentId })),
    summary: { ...proposal.summary, totalTravelMin: round2(proposal.summary.totalTravelMin) },
  });
}

/**
 * Ranked, eligible candidates for one open shift (task 17 offers; P15, P16):
 * consenting staff of the shift's provenance, their shifts at every store
 * counted, ranked by `@lanewise/matching`. Used both to list who may be
 * offered the shift and to re-check a selection before offers are sent.
 */
export async function rankForShift(
  db: Queryable,
  options: { readonly synthetic: boolean; readonly shift: OpenShift; readonly mode: NetworkMapQuery['mode']; readonly maxTravelMin: number },
): Promise<{ readonly result: MatchResult; readonly names: ReadonlyMap<string, string>; readonly travelSource: TravelSource }> {
  const { shift, mode, maxTravelMin } = options;
  const window = timeWindowOf(shift.date, Math.floor(shift.startHour));
  const candidates = await repo.listMatchCandidates(db, { synthetic: options.synthetic, date: shift.date });
  const query: NetworkMapQuery = { date: shift.date, dayPart: 'midday', mode, maxTravelMin };
  const t = await travelMatrix(db, candidates, [shift.storeId], query, window);
  const result = rankCandidates({ shift, mode, maxTravelMin, window }, candidates, t.matrix);
  const names = await repo.storeNames(db, [...new Set(candidates.map((c) => c.homeStoreId))]);
  return { result, names, travelSource: t.source };
}
