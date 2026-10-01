/**
 * Shift offers and store-to-store borrowing (task 17; Requirements 13, 14;
 * Q23–Q25; P14, P16, P17).
 *
 * Offers: a Planner or Store Manager broadcasts an open shift on a published
 * roster to selected eligible cashiers (P16 — trained, available, within
 * every labor rule with their hours at every store counted). Each offer
 * carries the store, time, travel time, pay and a flat transport allowance by
 * travel band, and expires 30 minutes after it is sent. The first acceptance
 * wins: the shift is assigned to that cashier and, at that same moment, every
 * other offer for the shift is withdrawn (P17). Accepted, declined and
 * expired offers notify the sender.
 *
 * Borrowing: a store short of cashiers asks a nearby store for n cashiers
 * for open shifts; the lending store's manager approves and picks who goes
 * (or declines). A Planner may approve instead of the lending manager only
 * with a recorded reason (Q24). Approved cashiers fill the open shifts on the
 * receiving roster, marked with their home store and travel time, and their
 * hours count toward their own weekly limits (P14).
 *
 * `applyAcceptance`, `expireOffers` and `declineOffer` are the offer state
 * machine as pure functions: the API enforces the same rules in one
 * transaction (plus a partial unique index and a trigger), and the SPA's
 * mock adapter and the P17 property tests use these directly.
 */
import type { IsoDate, IsoDateTime } from './entities.js';
import type { MapTravelMode } from './network-map.js';
import type { LocalShiftTimes } from './roster.js';

/** Offers expire this many minutes after they are sent (Q25, Req 13.2). */
export const OFFER_EXPIRY_MINUTES = 30;

/** Most cashiers one broadcast may go to. */
export const MAX_OFFER_RECIPIENTS = 20;

export const SHIFT_OFFER_STATUSES = ['sent', 'accepted', 'declined', 'expired', 'withdrawn'] as const;
export type ShiftOfferStatus = (typeof SHIFT_OFFER_STATUSES)[number];

/** Statuses an offer never leaves. */
export const FINAL_OFFER_STATUSES: readonly ShiftOfferStatus[] = ['accepted', 'declined', 'expired', 'withdrawn'];

// ---------------------------------------------------------------------------
// Transport allowance by travel band (Req 13.6, Q23)
// ---------------------------------------------------------------------------

/** A flat ₱ allowance for travel up to `upToMinutes` (bands ascending). */
export interface AllowanceBand {
  readonly upToMinutes: number;
  readonly amount: number;
}

/** Demo bands used when no `transport_allowance` rule version is published. */
export const DEFAULT_TRANSPORT_ALLOWANCE_BANDS: readonly AllowanceBand[] = [
  { upToMinutes: 15, amount: 0 },
  { upToMinutes: 30, amount: 50 },
  { upToMinutes: 45, amount: 80 },
  { upToMinutes: 60, amount: 120 },
];

const finiteNonNegative = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * Reads the bands of a `transport_allowance` rule payload. Accepts the rule
 * editor's shape (`upToMinutes`/`amount`) and the demo seed's
 * (`maxTravelMin`/`allowancePhp`); returns null when the payload has no
 * usable, ascending bands.
 */
export function readAllowanceBands(payload: unknown): AllowanceBand[] | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const bands = (payload as { bands?: unknown }).bands;
  if (!Array.isArray(bands) || bands.length === 0) return null;
  const out: AllowanceBand[] = [];
  for (const b of bands) {
    if (typeof b !== 'object' || b === null) return null;
    const r = b as Record<string, unknown>;
    const upTo = r.upToMinutes ?? r.maxTravelMin;
    const amount = r.amount ?? r.allowancePhp;
    if (!finiteNonNegative(upTo) || !finiteNonNegative(amount)) return null;
    const prev = out[out.length - 1];
    if (prev && upTo <= prev.upToMinutes) return null;
    out.push({ upToMinutes: upTo, amount });
  }
  return out;
}

/**
 * The flat allowance for `travelMin`: the first band the trip fits in; a
 * trip beyond the last band gets the last band's amount (offers never go
 * beyond the travel limit anyway).
 */
export function transportAllowanceFor(travelMin: number, bands: readonly AllowanceBand[] = DEFAULT_TRANSPORT_ALLOWANCE_BANDS): number {
  if (!Number.isFinite(travelMin) || travelMin < 0 || bands.length === 0) return 0;
  const band = bands.find((b) => travelMin <= b.upToMinutes) ?? bands[bands.length - 1];
  return band?.amount ?? 0;
}

// ---------------------------------------------------------------------------
// The offer state machine (P17)
// ---------------------------------------------------------------------------

export interface OfferState {
  readonly id: string;
  readonly shiftId: string;
  readonly staffId: string;
  readonly status: ShiftOfferStatus;
  readonly expiresAt: IsoDateTime;
  readonly respondedAt?: IsoDateTime | null;
}

/** Why an acceptance was refused. */
export type AcceptRefusal = 'not_found' | 'filled' | 'expired' | 'closed';

export type AcceptOutcome<T extends OfferState> =
  | { readonly ok: true; readonly offers: T[]; readonly accepted: T; readonly withdrawn: T[] }
  | { readonly ok: false; readonly code: AcceptRefusal };

const isDue = (o: OfferState, now: Date) => o.status === 'sent' && Date.parse(o.expiresAt) <= now.getTime();

/** Moves every sent offer whose expiry has passed to `expired`. */
export function expireOffers<T extends OfferState>(offers: readonly T[], now: Date): { offers: T[]; expired: T[] } {
  const expired: T[] = [];
  const next = offers.map((o) => {
    if (!isDue(o, now)) return o;
    const e = { ...o, status: 'expired' as const };
    expired.push(e);
    return e;
  });
  return { offers: next, expired };
}

/**
 * A cashier accepts `offerId` at `now`. Due offers expire first; then the
 * offer must still be `sent` and no offer for the shift may be accepted. On
 * success the offer is accepted and every other `sent` offer for the shift is
 * withdrawn at that same moment (P17).
 */
export function applyAcceptance<T extends OfferState>(offers: readonly T[], offerId: string, now: Date): AcceptOutcome<T> {
  const current = expireOffers(offers, now).offers;
  const target = current.find((o) => o.id === offerId);
  if (!target) return { ok: false, code: 'not_found' };
  if (current.some((o) => o.shiftId === target.shiftId && o.status === 'accepted')) return { ok: false, code: 'filled' };
  if (target.status === 'expired') return { ok: false, code: 'expired' };
  if (target.status !== 'sent') return { ok: false, code: 'closed' };
  const at = now.toISOString();
  const withdrawn: T[] = [];
  let accepted = target;
  const next = current.map((o) => {
    if (o.id === offerId) {
      accepted = { ...o, status: 'accepted' as const, respondedAt: at };
      return accepted;
    }
    if (o.shiftId === target.shiftId && o.status === 'sent') {
      const w = { ...o, status: 'withdrawn' as const, respondedAt: at };
      withdrawn.push(w);
      return w;
    }
    return o;
  });
  return { ok: true, offers: next, accepted, withdrawn };
}

/** A cashier declines `offerId`; only a `sent`, unexpired offer can be declined. */
export function declineOffer<T extends OfferState>(
  offers: readonly T[],
  offerId: string,
  now: Date,
): { readonly ok: true; readonly offers: T[]; readonly declined: T } | { readonly ok: false; readonly code: AcceptRefusal } {
  const current = expireOffers(offers, now).offers;
  const target = current.find((o) => o.id === offerId);
  if (!target) return { ok: false, code: 'not_found' };
  if (target.status === 'expired') return { ok: false, code: 'expired' };
  if (target.status !== 'sent') return { ok: false, code: 'closed' };
  const declined = { ...target, status: 'declined' as const, respondedAt: now.toISOString() };
  return { ok: true, offers: current.map((o) => (o.id === offerId ? declined : o)), declined };
}

/** P17 invariant over any set of offers: at most one accepted per shift, and none still sent beside it. */
export function singleAcceptanceHolds(offers: readonly OfferState[]): boolean {
  const byShift = new Map<string, OfferState[]>();
  for (const o of offers) byShift.set(o.shiftId, [...(byShift.get(o.shiftId) ?? []), o]);
  for (const group of byShift.values()) {
    const accepted = group.filter((o) => o.status === 'accepted').length;
    if (accepted > 1) return false;
    if (accepted === 1 && group.some((o) => o.status === 'sent')) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Offer DTOs
// ---------------------------------------------------------------------------

/** An offer as its sender and the roster see it (SCR-022, SCR-026). */
export interface ShiftOfferDto extends LocalShiftTimes {
  readonly id: string;
  readonly shiftId: string;
  readonly rosterId: string;
  readonly storeId: string;
  readonly departmentName: string;
  readonly staffId: string;
  /** Pseudonymous ID (employee number). */
  readonly displayId: string;
  /** Revealed only once the offer is accepted, or for the store's own cashiers (Req 12.5). */
  readonly name: string | null;
  readonly homeStoreName: string;
  readonly status: ShiftOfferStatus;
  readonly sentBy: string;
  readonly sentAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
  readonly respondedAt: IsoDateTime | null;
  readonly travelMin: number | null;
  /** Flat transport allowance (₱) by travel band. */
  readonly allowance: number;
  /** The cashier's pay for the shift (₱); omitted for roles that may not see individual cost (task 21). */
  readonly pay?: number;
}

export interface ShiftOffersResponse {
  readonly offers: readonly ShiftOfferDto[];
}

/** `POST /stores/:storeId/shifts/:shiftId/offers` */
export interface SendOffersRequest {
  readonly staffIds: readonly string[];
  /** Travel mode and limit the candidates were picked with (defaults: public transport, 30 min). */
  readonly mode?: MapTravelMode;
  readonly maxTravelMin?: number;
}

/** An eligible cashier for one open shift (P16), as the "Offer to eligible staff" picker lists them. */
export interface OfferCandidate {
  readonly staffId: string;
  readonly displayId: string;
  readonly homeStoreId: string;
  readonly homeStoreName: string;
  readonly homeArea: { readonly barangay: string; readonly city: string };
  readonly travelMin: number;
  readonly allowance: number;
  readonly weeklyHours: { readonly withShift: number; readonly limit: number };
  /** Already holds a live (sent) offer for this shift. */
  readonly offered: boolean;
}

export interface OfferCandidatesResponse extends LocalShiftTimes {
  readonly shiftId: string;
  readonly storeId: string;
  readonly mode: MapTravelMode;
  readonly maxTravelMin: number;
  readonly candidates: readonly OfferCandidate[];
  /** Cashiers left out for lack of home-area consent; counted only (P15). */
  readonly excludedWithoutConsent: number;
}

/** An offer as the offered cashier sees it (SCR-025): their own offer only, no other names (P11). */
export interface MyOfferDto extends LocalShiftTimes {
  readonly id: string;
  readonly storeName: string;
  readonly departmentName: string;
  readonly status: ShiftOfferStatus;
  readonly sentAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
  readonly respondedAt: IsoDateTime | null;
  readonly travelMin: number | null;
  readonly allowance: number;
  /** Their own pay for the shift (₱) — offer terms, not employer cost. */
  readonly pay: number;
}

export interface MyOffersResponse {
  readonly offers: readonly MyOfferDto[];
}

export interface MyOfferResponse {
  readonly offer: MyOfferDto;
}

// ---------------------------------------------------------------------------
// Borrowing (Req 14, Q24)
// ---------------------------------------------------------------------------

export const BORROW_STATUSES = ['pending', 'approved', 'declined', 'overridden', 'cancelled'] as const;
export type BorrowStatus = (typeof BORROW_STATUSES)[number];

/** Approved by the lending manager, or by a Planner's override with a reason. */
export const APPLIED_BORROW_STATUSES: readonly BorrowStatus[] = ['approved', 'overridden'];

export interface BorrowedCashierDto {
  readonly staffId: string;
  readonly employeeNo: string;
  readonly name: string;
  readonly shiftId: string;
}

export interface BorrowRequestDto {
  readonly id: string;
  readonly fromStoreId: string;
  readonly fromStoreName: string;
  readonly toStoreId: string;
  readonly toStoreName: string;
  readonly departmentName: string | null;
  readonly date: IsoDate;
  readonly windowStart: IsoDateTime;
  readonly windowEnd: IsoDateTime;
  readonly count: number;
  readonly shiftIds: readonly string[];
  readonly travelMin: number | null;
  readonly status: BorrowStatus;
  readonly note: string | null;
  readonly requestedBy: string;
  readonly requestedAt: IsoDateTime;
  readonly decidedBy: string | null;
  readonly decidedAt: IsoDateTime | null;
  /** The Planner's reason when they approved instead of the lending manager. */
  readonly overrideReason: string | null;
  readonly declineReason: string | null;
  readonly cashiers: readonly BorrowedCashierDto[];
}

export interface BorrowRequestsResponse {
  /** Requests where this store borrows (incoming cashiers). */
  readonly outgoing: readonly BorrowRequestDto[];
  /** Requests asking this store to lend. */
  readonly incoming: readonly BorrowRequestDto[];
}

/** `POST /stores/:storeId/borrow-requests` — `storeId` is the receiving store. */
export interface CreateBorrowRequest {
  readonly fromStoreId: string;
  /** Open shifts on the receiving store's published rosters to fill (one cashier each). */
  readonly shiftIds: readonly string[];
  readonly note?: string;
}

export interface BorrowRequestResponse {
  readonly request: BorrowRequestDto;
}

/** `POST /stores/:storeId/borrow-requests/:requestId/decision` — `storeId` is the lending store. */
export type BorrowDecisionRequest =
  | { readonly decision: 'approve'; readonly staffIds: readonly string[]; readonly reason?: string }
  | { readonly decision: 'decline'; readonly reason?: string };

/** A lending-store cashier the manager may pick for a request (own store: names shown). */
export interface LendCandidate {
  readonly staffId: string;
  readonly employeeNo: string;
  readonly name: string;
  readonly weekHours: number;
  /** Shift ids of the request this cashier could take within every labor rule (P16). */
  readonly eligibleShiftIds: readonly string[];
}

export interface LendCandidatesResponse {
  readonly requestId: string;
  readonly candidates: readonly LendCandidate[];
}

/**
 * Pairs picked cashiers with the request's shifts: each cashier takes the
 * first remaining shift they are eligible for, in the given order. Returns
 * null when some cashier cannot be placed.
 */
export function assignBorrowedCashiers(
  shiftIds: readonly string[],
  picks: readonly { readonly staffId: string; readonly eligibleShiftIds: readonly string[] }[],
): { staffId: string; shiftId: string }[] | null {
  // Small bipartite matching (augmenting paths) so the pick order never strands a cashier.
  const shiftOwner = new Map<string, number>();
  const tryAssign = (i: number, seen: Set<string>): boolean => {
    for (const s of picks[i]?.eligibleShiftIds ?? []) {
      if (!shiftIds.includes(s) || seen.has(s)) continue;
      seen.add(s);
      const owner = shiftOwner.get(s);
      if (owner === undefined || tryAssign(owner, seen)) {
        shiftOwner.set(s, i);
        return true;
      }
    }
    return false;
  };
  for (let i = 0; i < picks.length; i++) if (!tryAssign(i, new Set())) return null;
  const out: { staffId: string; shiftId: string }[] = [];
  for (const [shiftId, i] of shiftOwner) out.push({ staffId: picks[i]?.staffId ?? '', shiftId });
  return out.sort((a, b) => shiftIds.indexOf(a.shiftId) - shiftIds.indexOf(b.shiftId));
}
