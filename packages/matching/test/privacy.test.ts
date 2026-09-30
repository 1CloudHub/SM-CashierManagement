import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { findFineLocationKeys, hasActiveConsent, toPublicHomeArea, type HomeArea } from '../src/index.js';

describe('toPublicHomeArea', () => {
  it('keeps barangay and city only, whatever else the input carries', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.dictionary(fc.string(), fc.jsonValue()), (barangay, city, extra) => {
        const out = toPublicHomeArea({ ...extra, barangay, city } as HomeArea);
        expect(out).toEqual({ barangay: barangay.trim(), city: city.trim() });
      }),
    );
  });
});

describe('hasActiveConsent', () => {
  const loc = { homeArea: { barangay: 'Kapitolyo', city: 'Pasig' }, maxTravelMin: 30, crossStoreOffers: true };
  it('requires opt-in and honours withdrawal and re-consent', () => {
    expect(hasActiveConsent(null)).toBe(false);
    expect(hasActiveConsent({ ...loc, consentAt: null, withdrawnAt: null })).toBe(false);
    expect(hasActiveConsent({ ...loc, consentAt: '2026-09-01T00:00:00Z', withdrawnAt: null })).toBe(true);
    expect(hasActiveConsent({ ...loc, consentAt: '2026-09-01T00:00:00Z', withdrawnAt: '2026-09-02T00:00:00Z' })).toBe(false);
    expect(hasActiveConsent({ ...loc, consentAt: '2026-09-03T00:00:00Z', withdrawnAt: '2026-09-02T00:00:00Z' })).toBe(true);
  });
});

describe('findFineLocationKeys', () => {
  it('finds coordinate/address keys at any depth', () => {
    expect(findFineLocationKeys({ a: [{ b: { lat: 1 } }], address: 'x', ok: { barangay: 'y' } }).sort()).toEqual(['a[0].b.lat', 'address']);
    expect(findFineLocationKeys({ centroidLon: 1, geometry: { coordinates: [1, 2] } }).length).toBeGreaterThan(0);
    expect(findFineLocationKeys({ barangay: 'Kapitolyo', city: 'Pasig', travelMin: 12 })).toEqual([]);
  });
});
