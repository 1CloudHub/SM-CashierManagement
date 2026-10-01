/**
 * Network map and cross-store matching wire contracts (spec task 16.1, 16.4;
 * Req 11, 12; P1, P15, P16). Screen SCR-026.
 *
 *   GET /network-map                              stores as gap/surplus/balanced pins,
 *                                                 staff layer (barangay counts), rings
 *   GET /network-map/stores/:storeId/candidates   ranked candidates for one store
 *   GET /network-map/auto-match                   network-wide proposal (nothing sent)
 *
 * Privacy (P15): staff appear only with an active opt-in consent, and only as
 * pseudonymous ID + home store + barangay/city. The only coordinates in these
 * shapes are a STORE's site (a public business address, `MapStorePin.site`);
 * {@link assertNetworkMapPrivacy} checks everything else with the task 15
 * guard. Cost: these shapes carry no ₱ figure (offer pay arrives with task 17).
 */
import type { IsoDate, StoreFormat } from './entities.js';
import type { BarangayRef } from './location-privacy.js';
import { assertNoFineLocation, findFineLocation } from './location-privacy.js';

/** Travel modes (Req 11.2): public transport (estimated) or car. */
export const MAP_TRAVEL_MODES = ['public_transport', 'car'] as const;
export type MapTravelMode = (typeof MAP_TRAVEL_MODES)[number];

/** Day parts the travel matrix is precomputed for (early 00–10, midday 10–16, evening 16–24). */
export const MAP_DAY_PARTS = ['early', 'midday', 'evening'] as const;
export type MapDayPart = (typeof MAP_DAY_PARTS)[number];

/** Clock hours [start, end) of each day part. */
export const MAP_DAY_PART_HOURS: Readonly<Record<MapDayPart, readonly [number, number]>> = {
  early: [0, 10],
  midday: [10, 16],
  evening: [16, 24],
};

/** "Max travel" choices on the map (minutes). */
export const MAP_MAX_TRAVEL_CHOICES = [15, 30, 45, 60] as const;

/** Travel-time rings around the selected store, per mode (minutes). */
export const MAP_RING_MINUTES: Readonly<Record<MapTravelMode, readonly [number, number, number]>> = {
  public_transport: [15, 30, 45],
  car: [20, 40, 60],
};

export type StaffingStatus = 'gap' | 'surplus' | 'balanced';

/**
 * A store's staffing status from required vs rostered cashiers in the window:
 * `delta` = rostered − required (negative = short).
 */
export function staffingStatus(required: number, rostered: number): { readonly status: StaffingStatus; readonly delta: number } {
  const delta = rostered - required;
  return { status: delta < 0 ? 'gap' : delta > 0 ? 'surplus' : 'balanced', delta };
}

/** Where gap/surplus figures come from: the task 14 network view, or published-roster open shifts as the fallback. */
export type GapsSourceKind = 'published_roster' | 'network_view';

/** How travel minutes were obtained (design: straight-line fallback when the matrix is unavailable). */
export type TravelSource = 'matrix' | 'straight_line';

/** Common query of the three endpoints. */
export interface NetworkMapQuery {
  readonly date: IsoDate;
  readonly dayPart: MapDayPart;
  readonly mode: MapTravelMode;
  readonly maxTravelMin: number;
  /** Department key (normalised department name, the same across stores); all when omitted. */
  readonly department?: string;
  /** Store formats to include (Req 11.6); all when omitted. */
  readonly formats?: readonly StoreFormat[];
}

export interface MapStorePin {
  readonly storeId: string;
  readonly code: string;
  readonly name: string;
  readonly format: StoreFormat;
  /** Store site (business premises; not personal data). Null until geocoded. */
  readonly site: { readonly lat: number; readonly lon: number } | null;
  readonly required: number;
  readonly rostered: number;
  readonly delta: number;
  readonly status: StaffingStatus;
  readonly openShifts: number;
}

/** Staff layer: consenting cashiers counted per barangay (never listed, never positioned finer). */
export interface MapStaffArea {
  readonly barangay: BarangayRef;
  readonly count: number;
}

export interface MapDepartmentOption {
  readonly key: string;
  readonly name: string;
}

/** `GET /network-map` */
export interface NetworkMapResponse {
  readonly query: NetworkMapQuery;
  readonly rings: readonly number[];
  readonly gapsSource: GapsSourceKind;
  readonly stores: readonly MapStorePin[];
  readonly staffLayer: readonly MapStaffArea[];
  readonly departments: readonly MapDepartmentOption[];
}

/** A candidate as shown to planners and other stores' managers (Req 12.5): no name. */
export interface MapCandidate {
  /** Opaque id used to send an offer later (task 17). */
  readonly staffId: string;
  /** Pseudonymous display ID (employee number). */
  readonly displayId: string;
  readonly homeStoreId: string;
  readonly homeStoreName: string;
  readonly homeArea: { readonly barangay: string; readonly city: string };
  readonly travelMin: number | null;
  /** 1–3 = inside that ring; null = beyond the outer ring or unknown. */
  readonly ringBand: 1 | 2 | 3 | null;
}

export interface RankedMapCandidate extends MapCandidate {
  readonly rank: number;
  readonly travelMin: number;
  readonly weeklyHours: { readonly withShift: number; readonly limit: number; readonly headroom: number };
  readonly flags: readonly ('SIXTH_CONSECUTIVE_DAY' | 'CROSS_STORE')[];
}

export const CANDIDATE_EXCLUSION_CODES = [
  'NOT_TRAINED',
  'UNAVAILABLE',
  'CROSS_STORE_OPT_OUT',
  'ALREADY_ROSTERED',
  'MIN_REST',
  'WEEKLY_HOURS',
  'MANDATORY_REST',
  'TRAVEL_UNKNOWN',
  'TOO_FAR',
] as const;
export type CandidateExclusionCode = (typeof CANDIDATE_EXCLUSION_CODES)[number];

export interface ExcludedMapCandidate extends MapCandidate {
  readonly reasons: readonly CandidateExclusionCode[];
}

export interface NearbySurplusStore {
  readonly storeId: string;
  readonly name: string;
  readonly surplus: number;
  readonly travelMin: number;
}

/** `GET /network-map/stores/:storeId/candidates` */
export interface StoreCandidatesResponse {
  readonly query: NetworkMapQuery;
  readonly store: MapStorePin;
  /** The open shift candidates were ranked for (the store's first open shift in the window), or null. */
  readonly shift: { readonly shiftId: string; readonly departmentKey: string; readonly date: IsoDate; readonly startHour: number; readonly endHour: number } | null;
  readonly travelSource: TravelSource;
  readonly ranked: readonly RankedMapCandidate[];
  readonly excluded: readonly ExcludedMapCandidate[];
  /** Staff left out for lack of consent: a count, never identities (P15). */
  readonly excludedWithoutConsent: number;
  readonly nearbySurplus: readonly NearbySurplusStore[];
}

export interface AutoMatchOfferDto {
  readonly shiftId: string;
  readonly storeId: string;
  readonly storeName: string;
  readonly departmentKey: string;
  readonly date: IsoDate;
  readonly startHour: number;
  readonly endHour: number;
  readonly travelMin: number;
  readonly candidate: RankedMapCandidate;
}

export interface AutoMatchMoveDto {
  readonly fromStoreId: string;
  readonly fromStoreName: string;
  readonly toStoreId: string;
  readonly toStoreName: string;
  readonly departmentKey: string;
  readonly date: IsoDate;
  readonly count: number;
  readonly travelMin: number;
  readonly shiftIds: readonly string[];
}

export interface AutoMatchUnfilledDto {
  readonly shiftId: string;
  readonly storeId: string;
  readonly storeName: string;
  readonly departmentKey: string;
}

/** `GET /network-map/auto-match` — a proposal for review; nothing is sent (Req 11.7). */
export interface AutoMatchResponse {
  readonly query: NetworkMapQuery;
  readonly gapsSource: GapsSourceKind;
  readonly travelSource: TravelSource;
  readonly offers: readonly AutoMatchOfferDto[];
  readonly moves: readonly AutoMatchMoveDto[];
  readonly unfilled: readonly AutoMatchUnfilledDto[];
  readonly summary: {
    readonly openShifts: number;
    readonly covered: number;
    readonly offers: number;
    readonly moves: number;
    readonly movedCashiers: number;
    readonly storesInvolved: number;
    readonly totalTravelMin: number;
    readonly averageTravelMin: number;
    readonly excludedWithoutConsent: number;
  };
}

/** A shallow copy of a network-map body without the store sites (`stores[].site`, `store.site`). */
function withoutStoreSites(body: unknown): unknown {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return body;
  const strip = (pin: unknown): unknown => {
    if (pin === null || typeof pin !== 'object') return pin;
    const rest: Record<string, unknown> = { ...(pin as Record<string, unknown>) };
    delete rest.site;
    return rest;
  };
  const copy: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  if (Array.isArray(copy.stores)) copy.stores = copy.stores.map(strip);
  if ('store' in copy) copy.store = strip(copy.store);
  return copy;
}

/** Paths in a network-map response that would expose location finer than barangay (store sites excepted). */
export function findNetworkMapFineLocation(body: unknown): string[] {
  return findFineLocation(withoutStoreSites(body));
}

/**
 * P15 guard for network-map responses: everything except a store's own site
 * must be barangay-level at most. Returns the body unchanged or throws
 * `FineLocationError`.
 */
export function assertNetworkMapPrivacy<T>(body: T): T {
  assertNoFineLocation(withoutStoreSites(body));
  return body;
}
