import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  FineLocationError,
  assertNetworkMapPrivacy,
  findNetworkMapFineLocation,
  staffingStatus,
  type NetworkMapResponse,
} from '../src/index.js';

const pin = {
  storeId: 's1',
  code: 'MEGA',
  name: 'SM Megamall',
  format: 'sm_supermarket' as const,
  site: { lat: 14.585123, lon: 121.056789 },
  required: 26,
  rostered: 22,
  delta: -4,
  status: 'gap' as const,
  openShifts: 4,
};

const map: NetworkMapResponse = {
  query: { date: '2026-12-19', dayPart: 'midday', mode: 'public_transport', maxTravelMin: 30 },
  rings: [15, 30, 45],
  gapsSource: 'published_roster',
  stores: [pin],
  staffLayer: [{ barangay: { code: '137401002', name: 'Wack-Wack Greenhills', city: 'Mandaluyong' }, count: 3 }],
  departments: [{ key: 'main checkout lanes', name: 'Main checkout lanes' }],
};

describe('staffingStatus', () => {
  it('classifies short, surplus and balanced stores by rostered − required', () => {
    expect(staffingStatus(26, 22)).toEqual({ status: 'gap', delta: -4 });
    expect(staffingStatus(10, 13)).toEqual({ status: 'surplus', delta: 3 });
    expect(staffingStatus(8, 8)).toEqual({ status: 'balanced', delta: 0 });
  });

  it('agrees with the sign of the delta for any counts', () => {
    fc.assert(
      fc.property(fc.nat(500), fc.nat(500), (req, ros) => {
        const s = staffingStatus(req, ros);
        expect(s.delta).toBe(ros - req);
        expect(s.status).toBe(ros < req ? 'gap' : ros > req ? 'surplus' : 'balanced');
      }),
    );
  });
});

describe('network-map P15 guard', () => {
  it('allows a store site but nothing finer than barangay anywhere else', () => {
    expect(findNetworkMapFineLocation(map)).toEqual([]);
    expect(assertNetworkMapPrivacy(map)).toBe(map);
    expect(findNetworkMapFineLocation({ store: pin, ranked: [] })).toEqual([]);
  });

  it('rejects a coordinate or address anywhere outside the store site', () => {
    const leakyLayer = { ...map, staffLayer: [{ ...map.staffLayer[0], centroid: { lat: 14.5952, lon: 121.0521 } }] };
    expect(findNetworkMapFineLocation(leakyLayer)).toEqual(['staffLayer[0].centroid']);
    expect(() => assertNetworkMapPrivacy(leakyLayer)).toThrow(FineLocationError);
    const leakyCandidate = { store: pin, ranked: [{ displayId: 'XS-14', homeArea: { barangay: 'Wack-Wack', city: 'Mandaluyong', street: '1 Shaw Blvd' } }] };
    expect(findNetworkMapFineLocation(leakyCandidate)).toEqual(['ranked[0].homeArea.street']);
    // A pin's site is exempt only as `site` on a store pin.
    expect(findNetworkMapFineLocation({ ...map, stores: [{ ...pin, position: { lat: 14.5, lon: 121.0 } }] })).toEqual(['stores[0].position']);
  });
});
