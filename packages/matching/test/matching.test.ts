import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LABOR_LIMITS,
  FakeTravelTimeProvider,
  FORBIDDEN_LOCATION_KEYS,
  TravelTimeMatrix,
  findFineLocationKeys,
  homeAreaId,
  precomputeMatrix,
  rankCandidates,
  type HomeArea,
  type MatchCandidate,
  type MatchRequest,
  type MatchResult,
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
  { barangay: 'Poblacion', city: 'Makati' },
];
const STORES = ['mega', 'shaw', 'aura', 'nedsa', 'pasig'];
const DEPTS = ['MAIN', 'EXPRESS', 'CS'];

/** Sensitive-looking values smuggled into inputs; none may reach the output. */
const SECRET_STREET = '123 Rizal Street';
const SECRET_LAT = 14.58123456;
const SECRET_LON = 121.05654321;

let matrixPromise: Promise<TravelTimeMatrix> | undefined;
function matrix(): Promise<TravelTimeMatrix> {
  matrixPromise ??= precomputeMatrix(
    // Pin the SCR-026 example: Brgy. Wack-Wack → Megamall, 12 min by public transport.
    new FakeTravelTimeProvider({
      overrides: { [`${homeAreaId(AREAS[0]!)}|mega|public_transport`]: 12, [`${homeAreaId(AREAS[0]!)}|mega|car`]: 9 },
    }),
    { homeAreas: AREAS, storeIds: STORES },
  );
  return matrixPromise;
}

// Open shift: Saturday 2026-12-19, 13:00-17:00 at Megamall, MAIN (the SCR-026 example).
const SHIFT = { shiftId: 'open-1', storeId: 'mega', departmentId: 'MAIN', date: '2026-12-19', startHour: 13, endHour: 17 } as const;

function base(over: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    staffId: 'S1',
    homeStoreId: 'shaw',
    contractType: 'FT',
    skills: ['MAIN'],
    location: {
      homeArea: AREAS[0]!,
      consentAt: '2026-09-01T00:00:00Z',
      withdrawnAt: null,
      maxTravelMin: 45,
      crossStoreOffers: true,
    },
    unavailableDates: [],
    shifts: [],
    extraShiftsThisPeriod: 0,
    recentOffers: 0,
    ...over,
  };
}

const REQ: MatchRequest = { shift: SHIFT, mode: 'public_transport', maxTravelMin: 60 };

// ---------------------------------------------------------------------------
// Independent oracle (brute force, deliberately written separately from src)
// ---------------------------------------------------------------------------

const dayNo = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);
const absStart = (s: WorkShift) => dayNo(s.date) * 24 + s.startHour;
const absEnd = (s: WorkShift) => dayNo(s.date) * 24 + s.endHour;
const paid = (s: WorkShift) => s.paidHours ?? s.endHour - s.startHour;
const mondayOf = (d: string) => {
  const n = dayNo(d);
  const dow = (((n + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
  return n - ((dow + 6) % 7);
};

function oracleConsented(c: MatchCandidate): boolean {
  const l = c.location;
  if (!l || !l.consentAt) return false;
  return !l.withdrawnAt || l.withdrawnAt < l.consentAt;
}

function oracleEligible(req: MatchRequest, c: MatchCandidate, m: TravelTimeMatrix): boolean {
  const s = req.shift;
  if (!oracleConsented(c)) return false;
  if (!c.skills.includes(s.departmentId)) return false;
  if (c.unavailableDates.includes(s.date) || (c.restDays ?? []).includes(s.date)) return false;
  if (!c.location!.crossStoreOffers && c.homeStoreId !== s.storeId) return false;
  const all = [...c.shifts, s];
  // overlap + 10 h rest
  for (const o of c.shifts) {
    if (absStart(o) < absEnd(s) && absStart(s) < absEnd(o)) return false;
    const gap = absStart(o) >= absEnd(s) ? absStart(o) - absEnd(s) : absStart(s) - absEnd(o);
    if (gap < DEFAULT_LABOR_LIMITS.minRestBetweenShiftsHours) return false;
  }
  // weekly hours (Monday-start week, all stores)
  const wk = mondayOf(s.date);
  const hours = all.filter((x) => mondayOf(x.date) === wk).reduce((a, x) => a + paid(x), 0);
  if (hours > DEFAULT_LABOR_LIMITS.maxWeeklyHours[c.contractType]) return false;
  // mandatory rest: at most 6 consecutive working days around the new date,
  // and a 24 h gap after a 6-day run that includes it
  const days = new Set(all.map((x) => dayNo(x.date)));
  const d = dayNo(s.date);
  let lo = d;
  let hi = d;
  while (days.has(lo - 1)) lo--;
  while (days.has(hi + 1)) hi++;
  const run = hi - lo + 1;
  if (run > 6) return false;
  // Every 6-day run must be followed by a 24 h rest where the new shift is
  // part of the run or is the shift right after it.
  for (const start of days) {
    if (days.has(start - 1)) continue;
    let end = start;
    while (days.has(end + 1)) end++;
    if (end - start + 1 < 6) continue;
    const endOfRun = Math.max(...all.filter((x) => dayNo(x.date) === end).map(absEnd));
    const after = all.filter((x) => absStart(x) >= endOfRun).sort((a, b) => absStart(a) - absStart(b));
    const next = after[0];
    const involves = (d >= start && d <= end) || next === s;
    if (involves && next && absStart(next) - endOfRun < 24) return false;
  }
  const t = m.lookup(c.location!.homeArea, s.storeId, req.mode, req.window ?? 'weekend-midday');
  if (t === undefined) return false;
  if (t > Math.min(req.maxTravelMin, c.location!.maxTravelMin)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const WEEK = ['2026-12-12', '2026-12-13', '2026-12-14', '2026-12-15', '2026-12-16', '2026-12-17', '2026-12-18', '2026-12-19', '2026-12-20', '2026-12-21', '2026-12-22', '2026-12-23', '2026-12-24', '2026-12-25', '2026-12-26'];

const shiftArb = (i: number): fc.Arbitrary<WorkShift> =>
  fc
    .record({
      date: fc.constantFrom(...WEEK),
      startHour: fc.integer({ min: 5, max: 16 }),
      len: fc.integer({ min: 4, max: 10 }),
      storeId: fc.constantFrom(...STORES),
    })
    .map(({ date, startHour, len, storeId }) => ({ shiftId: `x${i}-${date}-${startHour}`, storeId, date, startHour, endHour: startHour + len }));

const candidateArb = (idx: number): fc.Arbitrary<MatchCandidate> =>
  fc
    .record({
      contractType: fc.constantFrom('FT' as const, 'PT' as const, 'FLOAT' as const),
      skills: fc.subarray(DEPTS),
      area: fc.constantFrom(...AREAS),
      consent: fc.constantFrom('given', 'none', 'withdrawn', 'reconsented', 'nolocation'),
      maxTravelMin: fc.constantFrom(15, 30, 45, 60, 90),
      crossStoreOffers: fc.boolean(),
      homeStoreId: fc.constantFrom(...STORES),
      unavailable: fc.subarray(WEEK, { maxLength: 3 }),
      restDays: fc.subarray(WEEK, { maxLength: 2 }),
      shifts: fc.array(fc.integer({ min: 0, max: 1000 }), { maxLength: 9 }).chain((ks) => fc.tuple(...ks.map((k) => shiftArb(k)))),
      extra: fc.nat(5),
      offers: fc.nat(5),
      cost: fc.option(fc.constantFrom(1, 1.25, 1.3, 2), { nil: undefined }),
      primary: fc.option(fc.constantFrom(...DEPTS), { nil: undefined }),
    })
    .map((r) => {
      const consentAt = r.consent === 'none' ? null : '2026-09-01T00:00:00Z';
      const withdrawnAt = r.consent === 'withdrawn' ? '2026-10-01T00:00:00Z' : r.consent === 'reconsented' ? '2026-08-01T00:00:00Z' : null;
      // Extra, non-schema location fields that must never leak.
      const leakyArea = { ...r.area, street: SECRET_STREET, centroidLat: SECRET_LAT, centroidLon: SECRET_LON } as HomeArea;
      const c: MatchCandidate = {
        staffId: `S${String(idx).padStart(3, '0')}`,
        displayId: `XS-${idx}`,
        homeStoreId: r.homeStoreId,
        contractType: r.contractType,
        skills: r.skills,
        location:
          r.consent === 'nolocation'
            ? null
            : { homeArea: leakyArea, consentAt, withdrawnAt, maxTravelMin: r.maxTravelMin, crossStoreOffers: r.crossStoreOffers },
        unavailableDates: r.unavailable,
        restDays: r.restDays,
        shifts: r.shifts,
        extraShiftsThisPeriod: r.extra,
        recentOffers: r.offers,
        ...(r.cost !== undefined ? { costIndex: r.cost } : {}),
        ...(r.primary !== undefined ? { primaryDepartmentId: r.primary } : {}),
      };
      return c;
    });

const candidatesArb = fc.integer({ min: 0, max: 25 }).chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => candidateArb(i))));

const requestArb: fc.Arbitrary<MatchRequest> = fc
  .record({
    storeId: fc.constantFrom(...STORES),
    departmentId: fc.constantFrom(...DEPTS),
    date: fc.constantFrom('2026-12-17', '2026-12-19', '2026-12-21'),
    startHour: fc.integer({ min: 6, max: 16 }),
    len: fc.integer({ min: 4, max: 8 }),
    mode: fc.constantFrom('public_transport' as const, 'car' as const),
    maxTravelMin: fc.constantFrom(15, 30, 45, 60),
  })
  .map((r) => ({
    shift: { shiftId: 'open', storeId: r.storeId, departmentId: r.departmentId, date: r.date, startHour: r.startHour, endHour: r.startHour + r.len },
    mode: r.mode,
    maxTravelMin: r.maxTravelMin,
    window: 'weekend-midday' as const,
  }));

function shuffle<T>(xs: readonly T[], seed: number): T[] {
  const out = [...xs];
  let s = seed >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1_103_515_245) + 12_345) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function compareRanked(a: MatchResult['ranked'][number], b: MatchResult['ranked'][number]): number {
  return (
    a.travelMin - b.travelMin ||
    b.weeklyHours.headroom - a.weeklyHours.headroom ||
    a.fairness.extraShiftsThisPeriod - b.fairness.extraShiftsThisPeriod ||
    a.fairness.recentOffers - b.fairness.recentOffers
  );
}

// ---------------------------------------------------------------------------
// Unit tests (SCR-026 examples)
// ---------------------------------------------------------------------------

describe('rankCandidates — eligibility rules', () => {
  it('ranks an eligible, consented, trained candidate with travel, headroom and rest details', async () => {
    const m = await matrix();
    const r = rankCandidates(REQ, [base()], m);
    expect(r.ranked).toHaveLength(1);
    const c = r.ranked[0]!;
    expect(c.rank).toBe(1);
    expect(c.homeArea).toEqual({ barangay: 'Wack-Wack', city: 'Mandaluyong' });
    expect(c.travelMin).toBe(12);
    expect(c.ringBand).toBe(1);
    expect(c.weeklyHours).toEqual({ scheduled: 0, withShift: 4, limit: 48, headroom: 44 });
    expect(c.restOk).toBe(true);
    expect(c.reasons.length).toBeGreaterThan(0);
  });

  const cases: Array<[string, Partial<MatchCandidate>, string]> = [
    ['not trained on the department', { skills: ['EXPRESS'] }, 'NOT_TRAINED'],
    ['unavailable that day', { unavailableDates: ['2026-12-19'] }, 'UNAVAILABLE'],
    ['rest day', { restDays: ['2026-12-19'] }, 'UNAVAILABLE'],
    ['already rostered in the window (other store)', { shifts: [{ shiftId: 'a', storeId: 'aura', date: '2026-12-19', startHour: 12, endHour: 16 }] }, 'ALREADY_ROSTERED'],
    ['less than 10 h rest before', { shifts: [{ shiftId: 'a', storeId: 'aura', date: '2026-12-19', startHour: 4, endHour: 8 }] }, 'MIN_REST'],
    ['less than 10 h rest after', { shifts: [{ shiftId: 'a', storeId: 'aura', date: '2026-12-20', startHour: 2, endHour: 6 }] }, 'MIN_REST'],
    [
      'weekly hours across stores',
      {
        contractType: 'PT',
        shifts: [
          { shiftId: 'a', storeId: 'aura', date: '2026-12-14', startHour: 8, endHour: 16 },
          { shiftId: 'b', storeId: 'shaw', date: '2026-12-15', startHour: 8, endHour: 16 },
          { shiftId: 'c', storeId: 'pasig', date: '2026-12-16', startHour: 8, endHour: 16 },
          { shiftId: 'd', storeId: 'aura', date: '2026-12-17', startHour: 8, endHour: 16 },
        ],
      },
      'WEEKLY_HOURS',
    ],
    ['cross-store offers opted out', { location: { ...base().location!, crossStoreOffers: false } }, 'CROSS_STORE_OPT_OUT'],
    ['beyond personal travel limit', { location: { ...base().location!, maxTravelMin: 1 } }, 'TOO_FAR'],
    ['home area not in the matrix', { location: { ...base().location!, homeArea: { barangay: 'Unknown', city: 'Nowhere' } } }, 'TRAVEL_UNKNOWN'],
  ];
  for (const [name, over, code] of cases) {
    it(`excludes: ${name} (${code})`, async () => {
      const r = rankCandidates(REQ, [base(over)], await matrix());
      expect(r.ranked).toHaveLength(0);
      expect(r.excluded).toHaveLength(1);
      expect(r.excluded[0]!.reasons.map((x) => x.code)).toContain(code);
    });
  }

  it('hard-blocks a 7th consecutive working day (mandatory 24 h rest)', async () => {
    const six = ['2026-12-13', '2026-12-14', '2026-12-15', '2026-12-16', '2026-12-17', '2026-12-18'].map((date, i) => ({
      shiftId: `w${i}`,
      storeId: 'shaw',
      date,
      startHour: 8,
      endHour: 12,
    }));
    const r = rankCandidates(REQ, [base({ shifts: six })], await matrix());
    expect(r.excluded[0]!.reasons.map((x) => x.code)).toContain('MANDATORY_REST');
  });

  it('flags (but allows) a 6th consecutive working day', async () => {
    const five = ['2026-12-14', '2026-12-15', '2026-12-16', '2026-12-17', '2026-12-18'].map((date, i) => ({
      shiftId: `w${i}`,
      storeId: 'shaw',
      date,
      startHour: 8,
      endHour: 12,
    }));
    const r = rankCandidates(REQ, [base({ shifts: five })], await matrix());
    expect(r.ranked).toHaveLength(1);
    expect(r.ranked[0]!.flags).toContain('SIXTH_CONSECUTIVE_DAY');
  });

  it('lists every failing rule for an excluded candidate', async () => {
    const r = rankCandidates(REQ, [base({ skills: [], unavailableDates: ['2026-12-19'] })], await matrix());
    expect(r.excluded[0]!.reasons.map((x) => x.code).sort()).toEqual(['NOT_TRAINED', 'UNAVAILABLE']);
  });

  it('drops staff without consent entirely — they are only counted', async () => {
    const r = rankCandidates(
      REQ,
      [
        base({ staffId: 'NOCONSENT', location: { ...base().location!, consentAt: null } }),
        base({ staffId: 'WITHDRAWN', location: { ...base().location!, withdrawnAt: '2026-10-01T00:00:00Z' } }),
        base({ staffId: 'NOAREA', location: null }),
        base({ staffId: 'OK' }),
      ],
      await matrix(),
    );
    expect(r.ranked.map((c) => c.staffId)).toEqual(['OK']);
    expect(r.excluded).toHaveLength(0);
    expect(r.excludedWithoutConsent).toBe(3);
    expect(JSON.stringify(r)).not.toMatch(/NOCONSENT|WITHDRAWN|NOAREA/);
  });

  it('rejects duplicate staff IDs and malformed shifts', async () => {
    const m = await matrix();
    expect(() => rankCandidates(REQ, [base(), base()], m)).toThrow(/duplicate/i);
    expect(() => rankCandidates({ ...REQ, shift: { ...SHIFT, endHour: 13 } }, [base()], m)).toThrow();
  });
});

describe('rankCandidates — ranking order', () => {
  it('orders by travel, then weekly-hours headroom, then fairness, then cost, then skill, then staff ID', async () => {
    const m = TravelTimeMatrix.fromEntries(
      AREAS.map((a, i) => ({
        homeAreaId: homeAreaId(a),
        storeId: 'mega',
        mode: 'public_transport' as const,
        window: 'weekend-midday' as const,
        minutes: i < 5 ? 20 : 10,
        computedAt: 't',
      })),
    );
    const at = (i: number) => ({ ...base().location!, homeArea: AREAS[i]! });
    const busy: WorkShift[] = [{ shiftId: 'b', storeId: 'shaw', date: '2026-12-15', startHour: 8, endHour: 16 }];
    const cands = [
      base({ staffId: 'E-cost', location: at(0), costIndex: 1.3 }),
      base({ staffId: 'A-near', location: at(5) }),
      base({ staffId: 'D-offers', location: at(1), recentOffers: 2, costIndex: 1 }),
      base({ staffId: 'B-headroom', location: at(2), costIndex: 1 }),
      base({ staffId: 'C-fair', location: at(3), shifts: busy, costIndex: 1 }),
      base({ staffId: 'F-busy-fair', location: at(4), shifts: busy, extraShiftsThisPeriod: 3 }),
      base({ staffId: 'G-cheap-skill', location: at(0), costIndex: 1.3, primaryDepartmentId: 'MAIN' }),
    ];
    const r = rankCandidates(REQ, cands, m);
    expect(r.ranked.map((c) => c.staffId)).toEqual(['A-near', 'B-headroom', 'G-cheap-skill', 'E-cost', 'D-offers', 'C-fair', 'F-busy-fair']);
    expect(r.ranked.map((c) => c.rank)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

// ---------------------------------------------------------------------------
// Property tests (P15, P16)
// ---------------------------------------------------------------------------

describe('properties', () => {
  it('P16: every ranked candidate satisfies every eligibility rule (cross-store hours counted), and every exclusion is justified', async () => {
    const m = await matrix();
    let rankedSeen = 0;
    let excludedSeen = 0;
    fc.assert(
      fc.property(requestArb, candidatesArb, (req, cands) => {
        const r = rankCandidates(req, cands, m);
        rankedSeen += r.ranked.length;
        excludedSeen += r.excluded.length;
        const byId = new Map(cands.map((c) => [c.staffId, c]));
        for (const c of r.ranked) expect(oracleEligible(req, byId.get(c.staffId)!, m)).toBe(true);
        for (const c of r.excluded) {
          expect(oracleEligible(req, byId.get(c.staffId)!, m)).toBe(false);
          expect(c.reasons.length).toBeGreaterThan(0);
        }
        // Completeness: every consented candidate is either ranked or excluded.
        const consented = cands.filter(oracleConsented).length;
        expect(r.ranked.length + r.excluded.length).toBe(consented);
        expect(r.excludedWithoutConsent).toBe(cands.length - consented);
        for (const c of r.ranked) {
          expect(c.weeklyHours.headroom).toBeGreaterThanOrEqual(0);
          expect(c.travelMin).toBeLessThanOrEqual(req.maxTravelMin);
          expect(c.restOk).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
    // Guard against a vacuous property: both branches must be exercised.
    expect(rankedSeen).toBeGreaterThan(5);
    expect(excludedSeen).toBeGreaterThan(5);
  });

  it('P15: consent=false (none, withdrawn, no home area) never appears in any output', async () => {
    const m = await matrix();
    fc.assert(
      fc.property(requestArb, candidatesArb, (req, cands) => {
        const r = rankCandidates(req, cands, m);
        const out = new Set([...r.ranked, ...r.excluded].map((c) => c.staffId));
        for (const c of cands) if (!oracleConsented(c)) expect(out.has(c.staffId)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it('P15: no output contains coordinates, an address or any location finer than barangay', async () => {
    const m = await matrix();
    fc.assert(
      fc.property(requestArb, candidatesArb, (req, cands) => {
        const r = rankCandidates(req, cands, m);
        expect(findFineLocationKeys(r)).toEqual([]);
        const json = JSON.stringify(r);
        expect(json).not.toContain(SECRET_STREET);
        expect(json).not.toContain(String(SECRET_LAT));
        expect(json).not.toContain(String(SECRET_LON));
        for (const k of FORBIDDEN_LOCATION_KEYS) expect(json).not.toContain(`"${k}"`);
        for (const c of [...r.ranked, ...r.excluded]) expect(Object.keys(c.homeArea).sort()).toEqual(['barangay', 'city']);
      }),
      { numRuns: 200 },
    );
  });

  it('ranking is sorted by the documented keys and ranks are 1..n', async () => {
    const m = await matrix();
    fc.assert(
      fc.property(requestArb, candidatesArb, (req, cands) => {
        const r = rankCandidates(req, cands, m);
        r.ranked.forEach((c, i) => expect(c.rank).toBe(i + 1));
        for (let i = 1; i < r.ranked.length; i++) expect(compareRanked(r.ranked[i - 1]!, r.ranked[i]!)).toBeLessThanOrEqual(0);
      }),
      { numRuns: 200 },
    );
  });

  it('ranking is deterministic and independent of input order', async () => {
    const m = await matrix();
    fc.assert(
      fc.property(requestArb, candidatesArb, fc.integer(), (req, cands, seed) => {
        const a = rankCandidates(req, cands, m);
        const b = rankCandidates(req, shuffle(cands, seed), m);
        expect(b).toEqual(a);
        expect(rankCandidates(req, cands, m)).toEqual(a);
      }),
      { numRuns: 200 },
    );
  });
});
