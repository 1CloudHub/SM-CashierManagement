import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LABOR_LIMITS,
  FakeTravelTimeProvider,
  autoMatch,
  findFineLocationKeys,
  greedyMatch,
  homeAreaId,
  precomputeMatrix,
  rankCandidates,
  timeWindowOf,
  TravelTimeMatrix,
  type AutoMatchInput,
  type AutoMatchProposal,
  type HomeArea,
  type MatchCandidate,
  type OpenShift,
  type StoreTravelTime,
  type SurplusSupply,
  type WorkShift,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AREAS: HomeArea[] = [
  { barangay: 'Wack-Wack', city: 'Mandaluyong' },
  { barangay: 'San Antonio', city: 'Pasig' },
  { barangay: 'Kapitolyo', city: 'Pasig' },
  { barangay: 'Socorro', city: 'Quezon City' },
  { barangay: 'Pinagsama', city: 'Taguig' },
];
const STORES = ['mega', 'shaw', 'aura', 'nedsa'];
const DEPTS = ['MAIN', 'EXPRESS'];
const DATES = ['2026-12-18', '2026-12-19'];

const SECRET_STREET = '123 Rizal Street';

let matrixPromise: Promise<TravelTimeMatrix> | undefined;
function matrix(): Promise<TravelTimeMatrix> {
  matrixPromise ??= precomputeMatrix(new FakeTravelTimeProvider(), { homeAreas: AREAS, storeIds: STORES });
  return matrixPromise;
}

/** Symmetric, deterministic store-to-store minutes (none to itself). */
const storeTravel: StoreTravelTime = (from, to, mode) => {
  if (from === to) return undefined;
  const a = STORES.indexOf(from);
  const b = STORES.indexOf(to);
  const base = 6 + ((a + 1) * (b + 1) * 7) % 37;
  return mode === 'car' ? base : Math.ceil(base * 1.5);
};

function cashier(i: number, over: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    staffId: `S${String(i).padStart(3, '0')}`,
    displayId: `XS-${i}`,
    homeStoreId: STORES[i % STORES.length]!,
    contractType: 'FT',
    skills: ['MAIN'],
    location: {
      homeArea: AREAS[i % AREAS.length]!,
      consentAt: '2026-09-01T00:00:00Z',
      withdrawnAt: null,
      maxTravelMin: 90,
      crossStoreOffers: true,
    },
    unavailableDates: [],
    shifts: [],
    extraShiftsThisPeriod: 0,
    recentOffers: 0,
    ...over,
  };
}

const open = (id: string, storeId: string, over: Partial<OpenShift> = {}): OpenShift => ({
  shiftId: id,
  storeId,
  departmentId: 'MAIN',
  date: '2026-12-19',
  startHour: 13,
  endHour: 17,
  ...over,
});

const travelOf = (p: AutoMatchProposal) => p.summary.totalTravelMin;

// ---------------------------------------------------------------------------
// Independent checks
// ---------------------------------------------------------------------------

const dayNo = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);
const absStart = (s: WorkShift) => dayNo(s.date) * 24 + s.startHour;
const absEnd = (s: WorkShift) => dayNo(s.date) * 24 + s.endHour;
const mondayOf = (d: string) => {
  const n = dayNo(d);
  return n - (((((n + 4) % 7) + 7) % 7) + 6) % 7;
};

/** P16 restated independently: trained, available, within every rule counting ALL stores' hours. */
function p16Holds(c: MatchCandidate, s: OpenShift, travelMin: number, maxTravelMin: number): string | null {
  const l = c.location;
  if (!l || !l.consentAt || (l.withdrawnAt && l.withdrawnAt >= l.consentAt)) return 'no consent';
  if (!c.skills.includes(s.departmentId)) return 'not trained';
  if (c.unavailableDates.includes(s.date) || (c.restDays ?? []).includes(s.date)) return 'unavailable';
  if (!l.crossStoreOffers && c.homeStoreId !== s.storeId) return 'cross-store opt-out';
  for (const o of c.shifts) {
    if (absStart(o) < absEnd(s) && absStart(s) < absEnd(o)) return 'overlap';
    const gap = absStart(o) >= absEnd(s) ? absStart(o) - absEnd(s) : absStart(s) - absEnd(o);
    if (gap < DEFAULT_LABOR_LIMITS.minRestBetweenShiftsHours) return 'rest';
  }
  const week = mondayOf(s.date);
  const hours = [...c.shifts, s].filter((x) => mondayOf(x.date) === week).reduce((a, x) => a + (x.paidHours ?? x.endHour - x.startHour), 0);
  if (hours > DEFAULT_LABOR_LIMITS.maxWeeklyHours[c.contractType]) return 'weekly hours (all stores)';
  const days = new Set([...c.shifts, s].map((x) => dayNo(x.date)));
  let lo = dayNo(s.date);
  let hi = lo;
  while (days.has(lo - 1)) lo--;
  while (days.has(hi + 1)) hi++;
  if (hi - lo + 1 > DEFAULT_LABOR_LIMITS.restAfterConsecutiveDays) return '7th day';
  if (travelMin > Math.min(maxTravelMin, l.maxTravelMin)) return 'too far';
  return null;
}

/**
 * Brute-force optimum for small inputs: the best (covered desc, travel asc)
 * over every assignment where each cashier takes at most one shift and each
 * surplus group lends at most its count.
 */
function bruteForce(input: AutoMatchInput): { covered: number; travel: number } {
  const slots = input.openShifts.map((s) => ({ ...s, window: timeWindowOf(s.date, s.startHour) }));
  const options = slots.map((s) => {
    const offers = rankCandidates({ shift: s, mode: input.mode, maxTravelMin: input.maxTravelMin, window: s.window }, input.candidates, input.matrix).ranked.map((c) => ({
      key: `c:${c.staffId}`,
      travel: c.travelMin,
    }));
    const moves = (input.surplus ?? []).flatMap((g, gi) => {
      if (g.storeId === s.storeId || g.departmentId !== s.departmentId || g.date !== s.date || g.window !== s.window || g.count <= 0) return [];
      const t = input.storeTravel?.(g.storeId, s.storeId, input.mode, s.window);
      return t === undefined || t > input.maxTravelMin ? [] : [{ key: `g:${gi}`, travel: t }];
    });
    return [...offers, ...moves];
  });
  const cap = new Map<string, number>((input.surplus ?? []).map((g, gi) => [`g:${gi}`, g.count]));
  const used = new Map<string, number>();
  let best = { covered: 0, travel: 0 };
  const go = (i: number, covered: number, travel: number) => {
    if (i === slots.length) {
      if (covered > best.covered || (covered === best.covered && travel < best.travel - 1e-9)) best = { covered, travel };
      return;
    }
    go(i + 1, covered, travel);
    for (const o of options[i]!) {
      const n = used.get(o.key) ?? 0;
      if (n >= (o.key.startsWith('g:') ? (cap.get(o.key) ?? 0) : 1)) continue;
      used.set(o.key, n + 1);
      go(i + 1, covered + 1, travel + o.travel);
      used.set(o.key, n);
    }
  };
  go(0, 0, 0);
  return best;
}

function assertWellFormed(input: AutoMatchInput, p: AutoMatchProposal): void {
  const byId = new Map(input.candidates.map((c) => [c.staffId, c]));
  const shifts = new Map(input.openShifts.map((s) => [s.shiftId, s]));
  // Every open shift is exactly one of: offered, moved, unfilled.
  const all = [...p.offers.map((o) => o.shiftId), ...p.moves.flatMap((m) => m.shiftIds), ...p.unfilled.map((u) => u.shiftId)];
  expect([...all].sort()).toEqual([...shifts.keys()].sort());
  // A cashier gets at most one proposed offer.
  const staff = p.offers.map((o) => o.candidate.staffId);
  expect(new Set(staff).size).toBe(staff.length);
  // P16 — every proposed cashier is eligible, counting cross-store hours.
  for (const o of p.offers) {
    const c = byId.get(o.candidate.staffId);
    expect(c, o.candidate.staffId).toBeDefined();
    expect(p16Holds(c!, shifts.get(o.shiftId)!, o.travelMin, input.maxTravelMin), `${o.candidate.staffId} → ${o.shiftId}`).toBeNull();
  }
  // Moves never exceed a store's surplus for that department/date/window.
  for (const m of p.moves) {
    const supply = (input.surplus ?? [])
      .filter((g) => g.storeId === m.fromStoreId && g.departmentId === m.departmentId && g.date === m.date && g.window === m.window)
      .reduce((a, g) => a + g.count, 0);
    const lent = p.moves.filter((x) => x.fromStoreId === m.fromStoreId && x.departmentId === m.departmentId && x.date === m.date && x.window === m.window).reduce((a, x) => a + x.count, 0);
    expect(lent).toBeLessThanOrEqual(supply);
    expect(m.fromStoreId).not.toBe(m.toStoreId);
    expect(m.travelMin).toBeLessThanOrEqual(input.maxTravelMin);
  }
  // P15 — consented staff only, barangay level only.
  for (const id of staff) {
    const l = byId.get(id)!.location;
    expect(l && l.consentAt && (!l.withdrawnAt || l.withdrawnAt < l.consentAt)).toBeTruthy();
  }
  expect(findFineLocationKeys(p)).toEqual([]);
  expect(JSON.stringify(p)).not.toContain(SECRET_STREET);
  for (const o of p.offers) expect(Object.keys(o.candidate.homeArea).sort()).toEqual(['barangay', 'city']);
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe('autoMatch', () => {
  it('beats the greedy order when the nearest cashier is everyone’s nearest', () => {
    // A is nearest to both shifts but only A can work EXPRESS. Greedy (canonical
    // order: aura before mega) gives A the MAIN shift at Aura and leaves the
    // EXPRESS shift at Megamall unfilled; the optimum covers both.
    const w = 'weekend-midday' as const;
    const cell = (area: HomeArea, storeId: string, minutes: number) => ({ homeAreaId: homeAreaId(area), storeId, mode: 'car' as const, window: w, minutes, computedAt: 'x' });
    const m = TravelTimeMatrix.fromEntries([cell(AREAS[0]!, 'aura', 5), cell(AREAS[0]!, 'mega', 10), cell(AREAS[1]!, 'aura', 20), cell(AREAS[1]!, 'mega', 40)]);
    const a = cashier(0, { skills: ['MAIN', 'EXPRESS'] });
    const b = cashier(1);
    const input: AutoMatchInput = {
      openShifts: [open('o1', 'aura'), open('o2', 'mega', { departmentId: 'EXPRESS' })],
      candidates: [a, b],
      matrix: m,
      mode: 'car',
      maxTravelMin: 60,
    };
    const g = greedyMatch(input);
    expect(g.summary.covered).toBe(1);
    const p = autoMatch(input);
    assertWellFormed(input, p);
    expect(p.summary.covered).toBe(2);
    expect(p.offers.find((o) => o.shiftId === 'o1')?.candidate.staffId).toBe('S001');
    expect(p.offers.find((o) => o.shiftId === 'o2')?.candidate.staffId).toBe('S000');
    expect(p.summary.totalTravelMin).toBe(30);
    expect(p.summary.averageTravelMin).toBe(15);
  });

  it('prefers the lower total travel when coverage ties', () => {
    const w = 'weekend-midday' as const;
    const cell = (area: HomeArea, storeId: string, minutes: number) => ({ homeAreaId: homeAreaId(area), storeId, mode: 'car' as const, window: w, minutes, computedAt: 'x' });
    // Greedy gives A (5) to Aura then B (50) to Mega = 55; optimum A→Mega (6) + B→Aura (8) = 14.
    const m = TravelTimeMatrix.fromEntries([cell(AREAS[0]!, 'aura', 5), cell(AREAS[0]!, 'mega', 6), cell(AREAS[1]!, 'aura', 8), cell(AREAS[1]!, 'mega', 50)]);
    const input: AutoMatchInput = { openShifts: [open('o1', 'aura'), open('o2', 'mega')], candidates: [cashier(0), cashier(1)], matrix: m, mode: 'car', maxTravelMin: 60 };
    expect(greedyMatch(input).summary.totalTravelMin).toBe(55);
    expect(autoMatch(input).summary.totalTravelMin).toBe(14);
  });

  it('proposes store-to-store moves from a surplus store in the same department and window', async () => {
    const m = await matrix();
    const window = timeWindowOf('2026-12-19', 13);
    const surplus: SurplusSupply[] = [{ storeId: 'aura', departmentId: 'MAIN', date: '2026-12-19', window, count: 2 }];
    const input: AutoMatchInput = {
      openShifts: [open('o1', 'mega'), open('o2', 'mega'), open('o3', 'mega')],
      candidates: [],
      matrix: m,
      surplus,
      storeTravel,
      mode: 'car',
      maxTravelMin: 60,
    };
    const p = autoMatch(input);
    assertWellFormed(input, p);
    expect(p.moves).toHaveLength(1);
    expect(p.moves[0]).toMatchObject({ fromStoreId: 'aura', toStoreId: 'mega', count: 2, departmentId: 'MAIN' });
    expect(p.unfilled).toHaveLength(1);
    expect(p.summary).toMatchObject({ openShifts: 3, covered: 2, offers: 0, moves: 1, movedCashiers: 2, storesInvolved: 2 });
  });

  it('never proposes a non-consented or withdrawn cashier, and counts them only', async () => {
    const m = await matrix();
    const none = cashier(0, { location: { homeArea: AREAS[0]!, consentAt: null, maxTravelMin: 90, crossStoreOffers: true } });
    const withdrawn = cashier(1, {
      location: { homeArea: AREAS[1]!, consentAt: '2026-09-01T00:00:00Z', withdrawnAt: '2026-09-15T00:00:00Z', maxTravelMin: 90, crossStoreOffers: true },
    });
    const missing = cashier(2, { location: null });
    const input: AutoMatchInput = { openShifts: [open('o1', 'mega')], candidates: [none, withdrawn, missing], matrix: m, mode: 'car', maxTravelMin: 180 };
    const p = autoMatch(input);
    expect(p.offers).toHaveLength(0);
    expect(p.summary.excludedWithoutConsent).toBe(3);
    expect(JSON.stringify(p)).not.toMatch(/S000|S001|S002/);
  });

  it('respects cross-store hours: a cashier at the weekly cap elsewhere is not proposed', async () => {
    const m = await matrix();
    const busy: WorkShift[] = ['2026-12-14', '2026-12-15', '2026-12-16', '2026-12-17'].map((date, i) => ({
      shiftId: `w${i}`,
      storeId: i % 2 === 0 ? 'shaw' : 'nedsa',
      date,
      startHour: 8,
      endHour: 20,
    }));
    const input: AutoMatchInput = { openShifts: [open('o1', 'mega')], candidates: [cashier(0, { shifts: busy })], matrix: m, mode: 'car', maxTravelMin: 180 };
    expect(autoMatch(input).offers).toHaveLength(0);
  });

  it('rejects duplicate open shifts and invalid limits', async () => {
    const m = await matrix();
    expect(() => autoMatch({ openShifts: [open('o1', 'mega'), open('o1', 'aura')], candidates: [], matrix: m, mode: 'car', maxTravelMin: 30 })).toThrow(/Duplicate/);
    expect(() => autoMatch({ openShifts: [], candidates: [], matrix: m, mode: 'car', maxTravelMin: 0 })).toThrow(/maxTravelMin/);
  });
});

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

const shiftArb = (k: number): fc.Arbitrary<WorkShift> =>
  fc
    .record({ date: fc.constantFrom('2026-12-14', '2026-12-15', '2026-12-16', '2026-12-17', '2026-12-18', '2026-12-19', '2026-12-20'), startHour: fc.integer({ min: 5, max: 14 }), len: fc.integer({ min: 4, max: 12 }), storeId: fc.constantFrom(...STORES) })
    .map((r) => ({ shiftId: `x${k}`, storeId: r.storeId, date: r.date, startHour: r.startHour, endHour: r.startHour + r.len }));

const candidateArb = (i: number): fc.Arbitrary<MatchCandidate> =>
  fc
    .record({
      contractType: fc.constantFrom('FT' as const, 'PT' as const, 'FLOAT' as const),
      skills: fc.subarray(DEPTS, { minLength: 1 }),
      area: fc.constantFrom(...AREAS),
      consent: fc.constantFrom('given', 'given', 'given', 'none', 'withdrawn', 'nolocation'),
      maxTravelMin: fc.constantFrom(30, 45, 60, 90),
      crossStoreOffers: fc.boolean(),
      homeStoreId: fc.constantFrom(...STORES),
      unavailable: fc.subarray(DATES, { maxLength: 1 }),
      shifts: fc.array(fc.nat(10_000), { maxLength: 6 }).chain((ks) => fc.tuple(...ks.map((k) => shiftArb(k)))),
    })
    .map((r) => ({
      ...cashier(i),
      homeStoreId: r.homeStoreId,
      contractType: r.contractType,
      skills: r.skills,
      location:
        r.consent === 'nolocation'
          ? null
          : {
              homeArea: { ...r.area, street: SECRET_STREET } as HomeArea,
              consentAt: r.consent === 'none' ? null : '2026-09-01T00:00:00Z',
              withdrawnAt: r.consent === 'withdrawn' ? '2026-09-20T00:00:00Z' : null,
              maxTravelMin: r.maxTravelMin,
              crossStoreOffers: r.crossStoreOffers,
            },
      unavailableDates: r.unavailable,
      shifts: r.shifts,
    }));

const openArb = (k: number): fc.Arbitrary<OpenShift> =>
  fc
    .record({ storeId: fc.constantFrom(...STORES), departmentId: fc.constantFrom(...DEPTS), date: fc.constantFrom(...DATES), startHour: fc.constantFrom(9, 13, 17) })
    .map((r) => ({ shiftId: `o${k}`, ...r, endHour: r.startHour + 4 }));

const surplusArb: fc.Arbitrary<SurplusSupply> = fc
  .record({ storeId: fc.constantFrom(...STORES), departmentId: fc.constantFrom(...DEPTS), date: fc.constantFrom(...DATES), startHour: fc.constantFrom(9, 13, 17), count: fc.integer({ min: 0, max: 2 }) })
  .map((r) => ({ storeId: r.storeId, departmentId: r.departmentId, date: r.date, window: timeWindowOf(r.date, r.startHour), count: r.count }));

const inputArb = (maxShifts: number, maxCandidates: number) =>
  fc
    .record({
      shifts: fc.integer({ min: 0, max: maxShifts }).chain((n) => fc.tuple(...Array.from({ length: n }, (_, k) => openArb(k)))),
      candidates: fc.integer({ min: 0, max: maxCandidates }).chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => candidateArb(i)))),
      surplus: fc.array(surplusArb, { maxLength: 3 }),
      mode: fc.constantFrom('public_transport' as const, 'car' as const),
      maxTravelMin: fc.constantFrom(30, 45, 60, 90),
    });

describe('autoMatch — properties', () => {
  it('P15/P16: every proposal is well-formed, eligible (cross-store hours counted), consented and barangay-level', async () => {
    const m = await matrix();
    await fc.assert(
      fc.property(inputArb(8, 10), (r) => {
        const input: AutoMatchInput = { openShifts: r.shifts, candidates: r.candidates, matrix: m, surplus: r.surplus, storeTravel, mode: r.mode, maxTravelMin: r.maxTravelMin };
        assertWellFormed(input, autoMatch(input));
        assertWellFormed(input, greedyMatch(input));
      }),
      { numRuns: 200 },
    );
  });

  it('never covers fewer shifts than the greedy per-gap baseline, and never needs more travel at equal coverage', async () => {
    const m = await matrix();
    await fc.assert(
      fc.property(inputArb(10, 12), (r) => {
        const input: AutoMatchInput = { openShifts: r.shifts, candidates: r.candidates, matrix: m, surplus: r.surplus, storeTravel, mode: r.mode, maxTravelMin: r.maxTravelMin };
        const a = autoMatch(input);
        const g = greedyMatch(input);
        expect(a.summary.covered).toBeGreaterThanOrEqual(g.summary.covered);
        if (a.summary.covered === g.summary.covered) expect(travelOf(a)).toBeLessThanOrEqual(travelOf(g) + 1e-9);
      }),
      { numRuns: 300 },
    );
  });

  it('is optimal: matches a brute-force search on small networks', async () => {
    const m = await matrix();
    await fc.assert(
      fc.property(inputArb(5, 5), (r) => {
        const input: AutoMatchInput = { openShifts: r.shifts, candidates: r.candidates, matrix: m, surplus: r.surplus, storeTravel, mode: r.mode, maxTravelMin: r.maxTravelMin };
        const a = autoMatch(input);
        const best = bruteForce(input);
        expect(a.summary.covered).toBe(best.covered);
        expect(travelOf(a)).toBeCloseTo(best.travel, 6);
      }),
      { numRuns: 200 },
    );
  });

  it('is deterministic and independent of input order', async () => {
    const m = await matrix();
    await fc.assert(
      fc.property(inputArb(6, 8), fc.nat(), (r, seed) => {
        const input: AutoMatchInput = { openShifts: r.shifts, candidates: r.candidates, matrix: m, surplus: r.surplus, storeTravel, mode: r.mode, maxTravelMin: r.maxTravelMin };
        const rev = <T,>(xs: readonly T[]) => (seed % 2 === 0 ? [...xs].reverse() : [...xs.slice(1), ...xs.slice(0, 1)]);
        const shuffled = { ...input, openShifts: rev(input.openShifts), candidates: rev(input.candidates), surplus: rev(input.surplus ?? []) };
        const a = autoMatch(input);
        const b = autoMatch(shuffled);
        expect(b.summary.covered).toBe(a.summary.covered);
        expect(travelOf(b)).toBeCloseTo(travelOf(a), 9);
      }),
      { numRuns: 100 },
    );
  });
});
