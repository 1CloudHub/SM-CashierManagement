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
          // Truncate to 4 decimals, then add a non-zero 5th decimal: the value
          // always has 5 decimals (adding 1e-5 to a 5-decimal rounding could
          // carry into a whole number such as 11.00000 and stop looking fine).
          const a = Math.trunc(lat * 1e4) / 1e4 + 0.00003;
          const b = Math.trunc(lon * 1e4) / 1e4 + 0.00003;
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
