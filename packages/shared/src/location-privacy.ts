/**
 * Location privacy and home-area consent (spec task 15; Requirement 12, P15;
 * RA 10173 — see docs/10-security-compliance/01-data-privacy.md, SEC-001).
 *
 * Wire contracts shared by the API and the SPA, plus the guard used to prove
 * that nothing leaving the API carries a location finer than barangay.
 *
 * Rules these types encode:
 *   - A home area is a barangay from the PSGC reference list (code + name +
 *     city). No address, street, coordinates or live location exists in any
 *     person-linked shape — not even the barangay's public centroid.
 *   - A home area exists only while the staff member has an active, opt-in
 *     consent to the current consent text. Withdrawing deletes it at once.
 *   - Planners see only counts per barangay; a staff member's barangay is
 *     shown to their own store's manager / HR, and to matching (task 16).
 */
import type { IsoDateTime } from './entities.js';

/** What a consent covers. Only home-area use for travel-based matching today. */
export const CONSENT_PURPOSES = ['home_area'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export function isConsentPurpose(value: unknown): value is ConsentPurpose {
  return typeof value === 'string' && (CONSENT_PURPOSES as readonly string[]).includes(value);
}

/** Locales the consent text is published in (matches the UI languages). */
export const CONSENT_LOCALES = ['en', 'fil'] as const;
export type ConsentLocale = (typeof CONSENT_LOCALES)[number];

/** Allowed maximum travel time (minutes); the profile offers 15/30/45. */
export const MAX_TRAVEL_MIN_BOUNDS = { min: 5, max: 180 } as const;
export const MAX_TRAVEL_MIN_CHOICES = [15, 30, 45] as const;

/** PSGC barangay code (9 or 10 digits). */
export const BARANGAY_CODE_PATTERN = /^[0-9]{9,10}$/;

/** One published, immutable version of the consent text. */
export interface ConsentText {
  readonly purpose: ConsentPurpose;
  readonly version: number;
  readonly locale: ConsentLocale;
  readonly body: string;
  readonly effectiveFrom: IsoDateTime;
}

/** A single grant (and possibly its withdrawal) — the consent history. */
export interface ConsentRecord {
  readonly id: string;
  readonly purpose: ConsentPurpose;
  readonly textVersion: number;
  readonly textLocale: ConsentLocale;
  readonly grantedAt: IsoDateTime;
  readonly withdrawnAt: IsoDateTime | null;
  readonly withdrawalReason: ConsentWithdrawalReason | null;
}

/** Why a grant ended: the staff member stopped sharing, left, or re-consented to a newer text. */
export const CONSENT_WITHDRAWAL_REASONS = ['staff_withdrew', 'staff_inactive', 'superseded'] as const;
export type ConsentWithdrawalReason = (typeof CONSENT_WITHDRAWAL_REASONS)[number];

/** The caller's consent state for one purpose. */
export interface ConsentStatus {
  readonly purpose: ConsentPurpose;
  /** True only while an un-withdrawn grant to a still-valid text version exists. */
  readonly active: boolean;
  /** The grant currently in force (null when none). */
  readonly grantedVersion: number | null;
  readonly grantedAt: IsoDateTime | null;
  /** Latest published text version; a newer version may require re-consent. */
  readonly currentVersion: number;
  /** True when a grant exists but a later text version requires fresh consent. */
  readonly reconsentRequired: boolean;
}

/** `GET /me/consents` */
export interface MyConsentsResponse {
  readonly consents: readonly {
    readonly status: ConsentStatus;
    /** The current text in the requested locale (falls back to English). */
    readonly text: ConsentText;
    readonly history: readonly ConsentRecord[];
  }[];
}

/** `POST /me/consents` body. `version` must be the current text version. */
export interface GrantConsentRequest {
  readonly purpose: ConsentPurpose;
  readonly version: number;
  readonly locale: ConsentLocale;
}

/** A barangay as shown to people: never with coordinates. */
export interface BarangayRef {
  readonly code: string;
  readonly name: string;
  readonly city: string;
}

/** The staff member's own home-area settings (SCR-080). */
export interface HomeAreaSettings {
  readonly barangay: BarangayRef;
  readonly maxTravelMin: number;
  readonly crossStoreOffers: boolean;
  readonly updatedAt: IsoDateTime;
}

/** `GET /me/home-area` */
export interface MyHomeAreaResponse {
  readonly consent: ConsentStatus;
  /** Null when not shared (no consent, withdrawn, or not set yet). */
  readonly homeArea: HomeAreaSettings | null;
}

/** `PUT /me/home-area` body — barangay code only, nothing finer. */
export interface SetHomeAreaRequest {
  readonly barangayCode: string;
  readonly maxTravelMin: number;
  readonly crossStoreOffers: boolean;
}

/** `GET /me/home-area/barangays` */
export interface BarangaySearchResponse {
  readonly barangays: readonly BarangayRef[];
}

/**
 * `GET /staff/:staffId/home-area` — own-store manager / HR view (SCR-053).
 * When not shared, nothing else is returned: not even whether a home area
 * existed before.
 */
export type StaffHomeAreaResponse =
  | { readonly staffId: string; readonly shared: false }
  | {
      readonly staffId: string;
      readonly shared: true;
      readonly barangay: BarangayRef;
      readonly maxTravelMin: number;
      readonly crossStoreOffers: boolean;
    };

/** Map layer input for planners: people counted per barangay, never listed. */
export interface BarangayStaffCount {
  readonly barangay: BarangayRef;
  readonly count: number;
}

// ---------------------------------------------------------------------------
// P15 guard: detect location finer than barangay in any outgoing value.
// ---------------------------------------------------------------------------

/**
 * Property names that would carry location finer than barangay. Kept in step
 * with `@lanewise/matching`'s list; compared case-insensitively.
 */
export const FINE_LOCATION_KEYS: readonly string[] = [
  'lat',
  'lon',
  'lng',
  'latitude',
  'longitude',
  'centroid',
  'centroidLat',
  'centroidLon',
  'centroid_lat',
  'centroid_lon',
  'coordinates',
  'coords',
  'geometry',
  'geojson',
  'position',
  'point',
  'gps',
  'address',
  'addressLine',
  'street',
  'streetAddress',
  'houseNumber',
  'unit',
  'building',
  'postalCode',
  'postcode',
  'zip',
  'zipCode',
  'purok',
  'sitio',
  'landmark',
];

const FINE_KEYS = new Set(FINE_LOCATION_KEYS.map((k) => k.toLowerCase()));

/** "14.5995, 120.9842", "POINT(121.03 14.65)" and similar coordinate text. */
const COORDINATE_TEXT = /-?\d{1,3}\.\d{3,}\s*[, ]\s*-?\d{1,3}\.\d{3,}/;

/**
 * Deep-scans a value for anything finer than barangay: forbidden property
 * names, coordinate-looking text, and non-integer numbers with 3+ decimals
 * (a latitude/longitude). Returns the offending paths; empty = clean.
 */
export function findFineLocation(value: unknown, path = ''): string[] {
  const out: string[] = [];
  const visit = (v: unknown, p: string): void => {
    if (Array.isArray(v)) {
      v.forEach((item, i) => visit(item, `${p}[${i}]`));
    } else if (v !== null && typeof v === 'object') {
      for (const [k, child] of Object.entries(v)) {
        const childPath = p ? `${p}.${k}` : k;
        if (FINE_KEYS.has(k.toLowerCase())) out.push(childPath);
        else visit(child, childPath);
      }
    } else if (typeof v === 'string') {
      if (COORDINATE_TEXT.test(v)) out.push(p || '(root)');
    } else if (typeof v === 'number') {
      if (Number.isFinite(v) && !Number.isInteger(v) && /\.\d{3,}/.test(String(v))) out.push(p || '(root)');
    }
  };
  visit(value, path);
  return out;
}

/** Raised when an outgoing value would expose location finer than barangay. */
export class FineLocationError extends Error {
  readonly paths: readonly string[];
  constructor(paths: readonly string[]) {
    super(`location finer than barangay at: ${paths.join(', ')}`);
    this.name = 'FineLocationError';
    this.paths = paths;
  }
}

/** Throws {@link FineLocationError} unless `value` is barangay-level at most (P15). */
export function assertNoFineLocation<T>(value: T): T {
  const paths = findFineLocation(value);
  if (paths.length > 0) throw new FineLocationError(paths);
  return value;
}
