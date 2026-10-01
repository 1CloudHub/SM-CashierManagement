import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  FINE_LOCATION_KEYS,
  FineLocationError,
  assertNoFineLocation,
  findFineLocation,
  isConsentPurpose,
  type StaffHomeAreaResponse,
} from '../src/index.js';

const barangay = { code: '137404001', name: 'Bagong Pag-asa', city: 'Quezon City' };

describe('findFineLocation (P15 guard)', () => {
  it('accepts barangay-level shapes', () => {
    const shared: StaffHomeAreaResponse = {
      staffId: 's-1',
      shared: true,
      barangay,
      maxTravelMin: 30,
      crossStoreOffers: true,
    };
    expect(findFineLocation(shared)).toEqual([]);
    expect(findFineLocation([{ barangay, count: 4 }])).toEqual([]);
    expect(assertNoFineLocation(shared)).toBe(shared);
  });

  it('flags every forbidden key at any depth and in any case', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...FINE_LOCATION_KEYS),
        fc.boolean(),
        fc.array(fc.constantFrom('a', 'b', 'items'), { maxLength: 3 }),
        (key, upper, prefix) => {
          const k = upper ? key.toUpperCase() : key;
          let value: unknown = { [k]: 'x' };
          for (const p of prefix) value = { [p]: [value] };
          expect(findFineLocation(value).length).toBeGreaterThan(0);
          expect(() => assertNoFineLocation(value)).toThrow(FineLocationError);
        },
      ),
    );
  });

  it('flags coordinate-looking numbers and text under innocent keys', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 4, max: 21, noNaN: true }),
        fc.double({ min: 116, max: 127, noNaN: true }),
        (lat, lon) => {
          // Always five decimals ending in 1, never an integer (5.99999 + 0.00001 would be 6).
          const fine = (x: number) => Number((Math.floor(x) + 0.10001 + Math.floor((x - Math.floor(x)) * 800) / 1000).toFixed(5));
          const a = fine(lat);
          const b = fine(lon);
          expect(findFineLocation({ where: a })).not.toEqual([]);
          expect(findFineLocation({ note: `${a.toFixed(5)}, ${b.toFixed(5)}` })).not.toEqual([]);
        },
      ),
    );
  });

  it('does not flag integers such as travel minutes and counts', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000 }), (n) => {
        expect(findFineLocation({ maxTravelMin: n, count: n })).toEqual([]);
      }),
    );
  });
});

describe('isConsentPurpose', () => {
  it('knows only home_area', () => {
    expect(isConsentPurpose('home_area')).toBe(true);
    expect(isConsentPurpose('gps')).toBe(false);
  });
});
