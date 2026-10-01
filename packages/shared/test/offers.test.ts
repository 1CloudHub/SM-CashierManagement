/**
 * Shift offers and borrowing contracts (task 17; Req 13, 14; P17): the offer
 * state machine, transport allowance bands and borrowed-cashier assignment.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSPORT_ALLOWANCE_BANDS,
  OFFER_EXPIRY_MINUTES,
  applyAcceptance,
  assignBorrowedCashiers,
  declineOffer,
  expireOffers,
  readAllowanceBands,
  singleAcceptanceHolds,
  transportAllowanceFor,
  type OfferState,
} from '../src/index.js';

const T0 = Date.parse('2026-12-19T01:00:00Z');
const at = (min: number) => new Date(T0 + min * 60_000);

function offers(shifts: number, perShift: number): OfferState[] {
  const out: OfferState[] = [];
  for (let s = 0; s < shifts; s++) {
    for (let i = 0; i < perShift; i++) {
      out.push({ id: `o${s}-${i}`, shiftId: `s${s}`, staffId: `c${i}`, status: 'sent', expiresAt: at(OFFER_EXPIRY_MINUTES).toISOString() });
    }
  }
  return out;
}

describe('offer state machine (P17)', () => {
  it('first acceptance wins and withdraws the other offers for the shift at that moment', () => {
    const start = offers(2, 3);
    const r = applyAcceptance(start, 'o0-1', at(5));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.accepted.status).toBe('accepted');
    expect(r.withdrawn.map((o) => o.id).sort()).toEqual(['o0-0', 'o0-2']);
    expect(r.withdrawn.every((o) => o.respondedAt === r.accepted.respondedAt)).toBe(true);
    // The other shift is untouched.
    expect(r.offers.filter((o) => o.shiftId === 's1').every((o) => o.status === 'sent')).toBe(true);
    const second = applyAcceptance(r.offers, 'o0-2', at(6));
    expect(second).toEqual({ ok: false, code: 'filled' });
  });

  it('expires offers 30 minutes after they are sent', () => {
    const start = offers(1, 2);
    expect(expireOffers(start, at(29)).expired).toHaveLength(0);
    expect(expireOffers(start, at(30)).expired).toHaveLength(2);
    expect(applyAcceptance(start, 'o0-0', at(31))).toEqual({ ok: false, code: 'expired' });
    expect(declineOffer(start, 'o0-0', at(31))).toEqual({ ok: false, code: 'expired' });
  });

  it('a declined offer cannot then be accepted; others stay open', () => {
    const d = declineOffer(offers(1, 2), 'o0-0', at(1));
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(applyAcceptance(d.offers, 'o0-0', at(2))).toEqual({ ok: false, code: 'closed' });
    expect(applyAcceptance(d.offers, 'o0-1', at(2)).ok).toBe(true);
  });

  it('property: any interleaving of accepts, declines and time passing keeps at most one accepted per shift, none sent beside it', () => {
    const op = fc.oneof(
      fc.record({ kind: fc.constant('accept' as const), shift: fc.nat(2), who: fc.nat(3), dt: fc.nat(20) }),
      fc.record({ kind: fc.constant('decline' as const), shift: fc.nat(2), who: fc.nat(3), dt: fc.nat(20) }),
      fc.record({ kind: fc.constant('tick' as const), shift: fc.constant(0), who: fc.constant(0), dt: fc.nat(40) }),
    );
    fc.assert(
      fc.property(fc.array(op, { maxLength: 40 }), (ops) => {
        let state = offers(3, 4);
        let now = 0;
        const acceptedAt = new Map<string, string>();
        for (const o of ops) {
          now += o.dt;
          const id = `o${o.shift}-${o.who}`;
          if (o.kind === 'tick') state = expireOffers(state, at(now)).offers;
          else if (o.kind === 'decline') {
            const r = declineOffer(state, id, at(now));
            if (r.ok) state = r.offers;
          } else {
            const r = applyAcceptance(state, id, at(now));
            if (r.ok) {
              expect(acceptedAt.has(`s${o.shift}`)).toBe(false);
              acceptedAt.set(`s${o.shift}`, id);
              state = r.offers;
            }
          }
          expect(singleAcceptanceHolds(state)).toBe(true);
        }
        // Accepted offers are exactly the first successful acceptance per shift.
        for (const o of state.filter((x) => x.status === 'accepted')) expect(acceptedAt.get(o.shiftId)).toBe(o.id);
      }),
    );
  });
});

describe('transport allowance by travel band (Req 13.6)', () => {
  it('uses the first band the trip fits in, the last beyond it', () => {
    expect(transportAllowanceFor(0)).toBe(0);
    expect(transportAllowanceFor(15)).toBe(0);
    expect(transportAllowanceFor(16)).toBe(50);
    expect(transportAllowanceFor(45)).toBe(80);
    expect(transportAllowanceFor(90)).toBe(120);
  });

  it('reads both the rule editor and the demo seed payload shapes', () => {
    expect(readAllowanceBands({ bands: [{ upToMinutes: 20, amount: 10 }] })).toEqual([{ upToMinutes: 20, amount: 10 }]);
    expect(readAllowanceBands({ bands: [{ maxTravelMin: 15, allowancePhp: 0 }, { maxTravelMin: 30, allowancePhp: 50 }] })).toEqual(
      DEFAULT_TRANSPORT_ALLOWANCE_BANDS.slice(0, 2),
    );
    expect(readAllowanceBands({ bands: [{ upToMinutes: 30, amount: 1 }, { upToMinutes: 20, amount: 2 }] })).toBeNull();
    expect(readAllowanceBands({})).toBeNull();
  });

  it('property: the allowance never decreases with travel time', () => {
    fc.assert(
      fc.property(fc.nat(120), fc.nat(120), (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(transportAllowanceFor(lo)).toBeLessThanOrEqual(transportAllowanceFor(hi));
      }),
    );
  });
});

describe('assignBorrowedCashiers', () => {
  it('places every pick on a distinct eligible shift, whatever the pick order', () => {
    const shifts = ['a', 'b'];
    expect(
      assignBorrowedCashiers(shifts, [
        { staffId: 'x', eligibleShiftIds: ['a', 'b'] },
        { staffId: 'y', eligibleShiftIds: ['a'] },
      ]),
    ).toEqual([
      { staffId: 'y', shiftId: 'a' },
      { staffId: 'x', shiftId: 'b' },
    ]);
    expect(assignBorrowedCashiers(shifts, [{ staffId: 'x', eligibleShiftIds: ['c'] }])).toBeNull();
    expect(
      assignBorrowedCashiers(['a'], [
        { staffId: 'x', eligibleShiftIds: ['a'] },
        { staffId: 'y', eligibleShiftIds: ['a'] },
      ]),
    ).toBeNull();
  });
});
