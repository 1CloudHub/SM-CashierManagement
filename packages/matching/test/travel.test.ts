import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PT_SPEED_FACTOR,
  FakeTravelTimeProvider,
  RING_BANDS_MIN,
  TIME_WINDOWS,
  TravelTimeMatrix,
  derivePublicTransport,
  homeAreaId,
  precomputeMatrix,
  ringBand,
  timeWindowOf,
  type HomeArea,
  type TravelTimeEntry,
  type TravelTimeProvider,
} from '../src/index.js';

const AREAS: HomeArea[] = [
  { barangay: 'Wack-Wack', city: 'Mandaluyong' },
  { barangay: 'San Antonio', city: 'Pasig' },
  { barangay: 'Kapitolyo', city: 'Pasig' },
  { barangay: 'Socorro', city: 'Quezon City' },
];
const STORES = ['mega', 'shaw', 'aura', 'nedsa'];

describe('ring bands', () => {
  it('uses 15/30/45 min for public transport and 20/40/60 min for car', () => {
    expect(RING_BANDS_MIN.public_transport).toEqual([15, 30, 45]);
    expect(RING_BANDS_MIN.car).toEqual([20, 40, 60]);
    expect(ringBand('public_transport', 12)).toBe(1);
    expect(ringBand('public_transport', 15)).toBe(1);
    expect(ringBand('public_transport', 16)).toBe(2);
    expect(ringBand('public_transport', 45)).toBe(3);
    expect(ringBand('public_transport', 46)).toBeNull();
    expect(ringBand('car', 20)).toBe(1);
    expect(ringBand('car', 41)).toBe(3);
    expect(ringBand('car', 61)).toBeNull();
  });

  it('is monotonic in minutes', () => {
    fc.assert(
      fc.property(fc.constantFrom('public_transport' as const, 'car' as const), fc.nat(120), fc.nat(120), (mode, a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const bl = ringBand(mode, lo) ?? 4;
        const bh = ringBand(mode, hi) ?? 4;
        expect(bl).toBeLessThanOrEqual(bh);
      }),
    );
  });
});

describe('time windows', () => {
  it('buckets by weekday/weekend and day part', () => {
    expect(timeWindowOf('2026-12-19', 13)).toBe('weekend-midday'); // Saturday
    expect(timeWindowOf('2026-12-21', 7)).toBe('weekday-early'); // Monday
    expect(timeWindowOf('2026-12-21', 18)).toBe('weekday-evening');
    expect(TIME_WINDOWS).toHaveLength(6);
  });
});

describe('homeAreaId', () => {
  it('is case/space-insensitive and uses barangay + city only', () => {
    expect(homeAreaId({ barangay: ' Wack-Wack ', city: 'MANDALUYONG' })).toBe(homeAreaId(AREAS[0]!));
    expect(homeAreaId(AREAS[1]!)).not.toBe(homeAreaId(AREAS[2]!));
  });
});

describe('TravelTimeMatrix', () => {
  const entry = (over: Partial<TravelTimeEntry> = {}): TravelTimeEntry => ({
    homeAreaId: homeAreaId(AREAS[0]!),
    storeId: 'mega',
    mode: 'car',
    window: 'weekend-midday',
    minutes: 12,
    computedAt: '2026-09-30T00:00:00Z',
    ...over,
  });

  it('looks up by home area, store, mode and window', () => {
    const m = TravelTimeMatrix.fromEntries([entry(), entry({ mode: 'public_transport', minutes: 18 })]);
    expect(m.lookup(AREAS[0]!, 'mega', 'car', 'weekend-midday')).toBe(12);
    expect(m.lookup(homeAreaId(AREAS[0]!), 'mega', 'public_transport', 'weekend-midday')).toBe(18);
    expect(m.lookup(AREAS[0]!, 'mega', 'car', 'weekday-early')).toBeUndefined();
    expect(m.size).toBe(2);
  });

  it('rejects duplicates and invalid minutes', () => {
    expect(() => TravelTimeMatrix.fromEntries([entry(), entry()])).toThrow(/duplicate/i);
    expect(() => TravelTimeMatrix.fromEntries([entry({ minutes: -1 })])).toThrow();
    expect(() => TravelTimeMatrix.fromEntries([entry({ minutes: Number.NaN })])).toThrow();
  });

  it('derives public-transport minutes from car minutes with the speed factor', () => {
    const pt = derivePublicTransport([entry({ minutes: 10 })]);
    expect(pt).toHaveLength(1);
    expect(pt[0]!.mode).toBe('public_transport');
    expect(pt[0]!.minutes).toBe(Math.ceil(10 * DEFAULT_PT_SPEED_FACTOR));
    expect(derivePublicTransport([entry({ minutes: 10 })], 2)[0]!.minutes).toBe(20);
    expect(() => derivePublicTransport([entry()], 0.5)).toThrow();
  });
});

describe('FakeTravelTimeProvider', () => {
  it('is deterministic and covers every requested pair', async () => {
    const p = new FakeTravelTimeProvider();
    const req = { homeAreas: AREAS, storeIds: STORES, mode: 'car' as const, window: 'weekend-midday' as const };
    const a = await p.computeMatrix(req);
    const b = await new FakeTravelTimeProvider().computeMatrix(req);
    expect(a).toEqual(b);
    expect(a).toHaveLength(AREAS.length * STORES.length);
    for (const e of a) {
      expect(Number.isInteger(e.minutes)).toBe(true);
      expect(e.minutes).toBeGreaterThan(0);
    }
  });

  it('honours explicit overrides', async () => {
    const p = new FakeTravelTimeProvider({ overrides: { [`${homeAreaId(AREAS[0]!)}|mega|car`]: 7 } });
    const out = await p.computeMatrix({ homeAreas: [AREAS[0]!], storeIds: ['mega'], mode: 'car', window: 'weekday-early' });
    expect(out[0]!.minutes).toBe(7);
  });
});

describe('precomputeMatrix', () => {
  it('fills every mode and window, deriving public transport when the provider only does car', async () => {
    const calls: string[] = [];
    const inner = new FakeTravelTimeProvider({ supportedModes: ['car'] });
    const provider: TravelTimeProvider = {
      name: 'spy',
      supportedModes: inner.supportedModes,
      computeMatrix: (req) => {
        calls.push(`${req.mode}/${req.window}`);
        return inner.computeMatrix(req);
      },
    };
    const m = await precomputeMatrix(provider, { homeAreas: AREAS, storeIds: STORES });
    expect(calls.every((c) => c.startsWith('car/'))).toBe(true);
    expect(calls).toHaveLength(TIME_WINDOWS.length);
    expect(m.size).toBe(AREAS.length * STORES.length * TIME_WINDOWS.length * 2);
    for (const w of TIME_WINDOWS) {
      const car = m.lookup(AREAS[1]!, 'aura', 'car', w)!;
      expect(m.lookup(AREAS[1]!, 'aura', 'public_transport', w)).toBe(Math.ceil(car * DEFAULT_PT_SPEED_FACTOR));
    }
  });

  it('ignores entries the provider returns for pairs that were not requested', async () => {
    const provider: TravelTimeProvider = {
      name: 'noisy',
      supportedModes: ['car', 'public_transport'],
      computeMatrix: async (req) => [
        { homeAreaId: homeAreaId(AREAS[0]!), storeId: 'mega', mode: req.mode, window: req.window, minutes: 5, computedAt: 'x' },
        { homeAreaId: 'nowhere|x', storeId: 'mega', mode: req.mode, window: req.window, minutes: 5, computedAt: 'x' },
      ],
    };
    const m = await precomputeMatrix(provider, { homeAreas: [AREAS[0]!], storeIds: ['mega'], modes: ['car'], windows: ['weekday-early'] });
    expect(m.size).toBe(1);
  });
});
