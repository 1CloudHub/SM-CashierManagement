/**
 * Location privacy for cross-store matching (spec Req 12, P15; RA 10173).
 *
 * A staff member's home area is held at barangay level only — barangay + city,
 * never an address, coordinates or live location — and is used for matching
 * only while they have opted in. Everything this package returns goes through
 * {@link toPublicHomeArea}, which copies those two fields and nothing else, so
 * extra properties on an input object can never leak into an output.
 */

export type IsoDate = string;
export type IsoDateTime = string;

/** A home area at barangay granularity. There is deliberately no finer field. */
export interface HomeArea {
  readonly barangay: string;
  readonly city: string;
}

/** A staff member's opt-in home-area record (DOM-002 StaffHomeArea, minus the centroid). */
export interface HomeAreaConsent {
  readonly homeArea: HomeArea;
  /** When the staff member opted in; `null` = never consented. */
  readonly consentAt: IsoDateTime | null;
  /** When they withdrew consent; a later `consentAt` means they opted in again. */
  readonly withdrawnAt?: IsoDateTime | null;
  /** The staff member's own maximum travel time (minutes). */
  readonly maxTravelMin: number;
  /** Whether they accept offers at stores other than their home store. */
  readonly crossStoreOffers: boolean;
}

/** True only while the staff member has an un-withdrawn opt-in (Req 12.2, 12.3). */
export function hasActiveConsent(c: HomeAreaConsent | null | undefined): c is HomeAreaConsent {
  if (!c || !c.consentAt) return false;
  return !c.withdrawnAt || c.withdrawnAt < c.consentAt;
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** Stable matrix key for a home area: `city|barangay`, case- and whitespace-insensitive. */
export function homeAreaId(a: HomeArea): string {
  return `${norm(a.city)}|${norm(a.barangay)}`;
}

/** The only shape in which a home area leaves this package (Req 12.4). */
export function toPublicHomeArea(a: HomeArea): HomeArea {
  return { barangay: String(a.barangay).trim(), city: String(a.city).trim() };
}

/** Property names that would carry location finer than barangay. */
export const FORBIDDEN_LOCATION_KEYS: readonly string[] = [
  'lat',
  'lon',
  'lng',
  'latitude',
  'longitude',
  'centroidLat',
  'centroidLon',
  'coordinates',
  'coords',
  'geometry',
  'position',
  'point',
  'gps',
  'address',
  'street',
  'streetAddress',
  'houseNumber',
  'postalCode',
  'zip',
  'purok',
  'sitio',
];

const FORBIDDEN = new Set(FORBIDDEN_LOCATION_KEYS.map((k) => k.toLowerCase()));

/**
 * Deep-scan a value for property names that would expose location finer than
 * barangay. Returns the offending paths (empty = clean). Used by tests and as
 * a guard for API responses built from matching results.
 */
export function findFineLocationKeys(value: unknown, path = ''): string[] {
  const out: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => out.push(...findFineLocationKeys(v, `${path}[${i}]`)));
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const p = path ? `${path}.${k}` : k;
      if (FORBIDDEN.has(k.toLowerCase())) out.push(p);
      else out.push(...findFineLocationKeys(v, p));
    }
  }
  return out;
}
