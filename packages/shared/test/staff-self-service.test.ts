/**
 * Staff self-service contracts (task 18; Req 15; P11, P19): request
 * validation, the own-travel-limit rule for offers and the `.ics` builder.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MAX_TIME_OFF_DAYS,
  buildShiftCalendar,
  daysInclusive,
  offerWithinTravelLimit,
  validateCreateStaffRequest,
  validateStaffRequestDecision,
} from '../src/index.js';

const TODAY = '2026-12-10';

describe('validateCreateStaffRequest', () => {
  it('accepts a time-off range from today, with an optional reason and note', () => {
    expect(validateCreateStaffRequest({ type: 'time_off', dateFrom: TODAY, dateTo: '2026-12-12', reason: 'family', note: 'Wedding' }, TODAY)).toEqual({
      ok: true,
      value: { type: 'time_off', dateFrom: TODAY, dateTo: '2026-12-12', reason: 'family', note: 'Wedding' },
    });
    expect(validateCreateStaffRequest({ type: 'time_off', dateFrom: '2026-12-24', dateTo: '2026-12-24' }, TODAY).ok).toBe(true);
  });

  it('refuses past starts, reversed or overlong ranges, bad dates, reasons and unknown fields', () => {
    const paths = (v: unknown) => {
      const r = validateCreateStaffRequest(v, TODAY);
      return r.ok ? [] : r.issues.map((i) => i.path);
    };
    expect(paths({ type: 'time_off', dateFrom: '2026-12-09', dateTo: '2026-12-12' })).toEqual(['dateFrom']);
    expect(paths({ type: 'time_off', dateFrom: '2026-12-12', dateTo: '2026-12-11' })).toEqual(['dateTo']);
    expect(paths({ type: 'time_off', dateFrom: '2026-12-12', dateTo: '2027-02-12' })).toEqual(['dateTo']);
    expect(paths({ type: 'time_off', dateFrom: '2026-02-30', dateTo: '2026-12-12' })).toEqual(['dateFrom']);
    expect(paths({ type: 'time_off', dateFrom: TODAY, dateTo: TODAY, reason: 'beach' })).toEqual(['reason']);
    expect(paths({ type: 'time_off', dateFrom: TODAY, dateTo: TODAY, staffId: 'x' })).toEqual(['staffId']);
    expect(paths({ type: 'time_off', dateFrom: TODAY, dateTo: TODAY, note: 'x'.repeat(501) })).toEqual(['note']);
    expect(paths({ type: 'holiday' })).toEqual(['type']);
    expect(paths(null)).toEqual(['']);
  });

  it('needs two different shifts for a swap', () => {
    expect(validateCreateStaffRequest({ type: 'swap', offeredShiftId: 'a', targetShiftId: 'b' }, TODAY).ok).toBe(true);
    const same = validateCreateStaffRequest({ type: 'swap', offeredShiftId: 'a', targetShiftId: 'a' }, TODAY);
    expect(same.ok ? [] : same.issues.map((i) => i.path)).toEqual(['targetShiftId']);
    const missing = validateCreateStaffRequest({ type: 'swap', offeredShiftId: 'a', dateFrom: TODAY }, TODAY);
    expect(missing.ok ? [] : missing.issues.map((i) => i.path).sort()).toEqual(['dateFrom', 'targetShiftId']);
  });

  it('accepts exactly the ranges of at most the maximum days (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 60 }), fc.integer({ min: 0, max: 60 }), (startOffset, length) => {
        const add = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
        const from = add(TODAY, startOffset);
        const to = add(from, length);
        expect(daysInclusive(from, to)).toBe(length + 1);
        expect(validateCreateStaffRequest({ type: 'time_off', dateFrom: from, dateTo: to }, TODAY).ok).toBe(length + 1 <= MAX_TIME_OFF_DAYS);
      }),
    );
  });
});

describe('validateStaffRequestDecision', () => {
  it('takes approve or decline with an optional reason and note', () => {
    expect(validateStaffRequestDecision({ decision: 'approve', reason: 'Peak cover' }).ok).toBe(true);
    expect(validateStaffRequestDecision({ decision: 'decline', note: 'Need cover Sat' }).ok).toBe(true);
    expect(validateStaffRequestDecision({ decision: 'maybe' }).ok).toBe(false);
    expect(validateStaffRequestDecision({ decision: 'approve', staffId: 'x' }).ok).toBe(false);
  });
});

describe('offerWithinTravelLimit (Req 15.2)', () => {
  it('keeps own-store offers, and other stores only with cross-store offers on and within the limit', () => {
    fc.assert(
      fc.property(
        fc.option(fc.integer({ min: 0, max: 200 }), { nil: null }),
        fc.boolean(),
        fc.option(fc.record({ maxTravelMin: fc.integer({ min: 5, max: 180 }), crossStoreOffers: fc.boolean() }), { nil: null }),
        (travelMin, ownStore, limit) => {
          const ok = offerWithinTravelLimit({ travelMin, ownStore }, limit);
          const expected = ownStore || (limit !== null && limit.crossStoreOffers && travelMin !== null && travelMin <= limit.maxTravelMin);
          expect(ok).toBe(expected);
        },
      ),
    );
  });
});

describe('buildShiftCalendar', () => {
  it('writes one UTC event per shift with stable UIDs, escaped text and CRLF lines', () => {
    const ics = buildShiftCalendar(
      [
        { id: 's2', date: '2026-12-19', startMin: 12 * 60, endMin: 21 * 60, title: 'Main checkout lanes', location: 'SM Supermarket, Quezon City' },
        { id: 's1', date: '2026-12-15', startMin: 15 * 60, endMin: 26 * 60, title: 'Express; late', location: 'SM Megamall' },
      ],
      { name: 'My LaneWise shifts', now: new Date('2026-12-10T01:02:03.456Z') },
    );
    const lines = ics.split('\r\n');
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    // Sorted by date; Manila is UTC+8 and an overnight shift ends the next day.
    expect(ics.indexOf('UID:shift-s1@lanewise')).toBeLessThan(ics.indexOf('UID:shift-s2@lanewise'));
    expect(lines).toContain('DTSTART:20261215T070000Z');
    expect(lines).toContain('DTEND:20261215T180000Z');
    expect(lines).toContain('DTSTART:20261219T040000Z');
    expect(lines).toContain('DTEND:20261219T130000Z');
    expect(lines).toContain('DTSTAMP:20261210T010203Z');
    expect(lines).toContain('SUMMARY:Express\\; late');
    expect(lines).toContain('LOCATION:SM Supermarket\\, Quezon City');
  });

  it('folds long lines at 75 octets', () => {
    const ics = buildShiftCalendar([{ id: 'x', date: '2026-12-19', startMin: 0, endMin: 60, title: 'Ñ'.repeat(100), location: 'L' }], {
      name: 'n',
      now: new Date(0),
    });
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(ics.split('\r\n').filter((l) => l.startsWith(' ')).length).toBeGreaterThan(0);
  });
});
