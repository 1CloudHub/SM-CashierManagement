/**
 * Network map and cross-store matching reads (task 16.1, 16.4; Req 11, 12;
 * P1, P15, P16, P18).
 *
 *   - Stores come from {@link listStoresInScope} (P1), with their site from
 *     `store_location` (a public business address, not personal data).
 *   - Staff reach matching ONLY through the `home_area_matchable` view (task
 *     15): active staff with an active opt-in consent, barangay name/city
 *     only. Non-consented or withdrawn staff are never read here (P15).
 *   - A candidate's shifts are read across ALL stores, so eligibility counts
 *     cross-store hours (P16).
 *   - Straight-line travel estimates are computed inside PostgreSQL from the
 *     barangay's public centroid; only kilometres leave the database, never a
 *     coordinate tied to a person.
 *   - Every read is single-provenance (P18): demo and real rows are never mixed.
 */
import type { MatchCandidate, TravelMode, WorkShift } from '@lanewise/matching';
import type { Scope, StoreFormat } from '@lanewise/shared';
import { isStoreInScope } from '@lanewise/shared';
import type { Queryable } from '../pool.js';
import { listStoresInScope, type StoreRecord } from './org.js';

/** Store-local time zone for every store in phase 1 (Metro Manila). */
export const STORE_TIME_ZONE = 'Asia/Manila';
const UTC_OFFSET = '+08:00';

/** Department key: the department name, normalised, so it matches across stores. */
export function departmentKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export interface MapStoreRecord extends StoreRecord {
  readonly site: { readonly lat: number; readonly lon: number } | null;
}

/**
 * Whether this caller's map runs on demo data: only when no real active store
 * is in scope (real data wins; the two are never mixed, P18).
 */
export async function mapProvenance(db: Queryable, scope: Scope): Promise<boolean> {
  const stores = (await listStoresInScope(db, scope)).filter((s) => s.active && isStoreInScope(scope, s));
  return stores.length > 0 && stores.every((s) => s.synthetic);
}

/** Active in-scope stores of one provenance, optionally by format, with their sites (P1). */
export async function listMapStores(
  db: Queryable,
  scope: Scope,
  options: { readonly synthetic: boolean; readonly formats?: readonly StoreFormat[] },
): Promise<MapStoreRecord[]> {
  const stores = (await listStoresInScope(db, scope)).filter(
    (s) =>
      s.active &&
      s.synthetic === options.synthetic &&
      isStoreInScope(scope, s) &&
      (options.formats === undefined || options.formats.length === 0 || options.formats.includes(s.format)),
  );
  if (stores.length === 0) return [];
  const { rows } = await db.query<{ store_id: string; lat: string; lon: string }>(
    'SELECT store_id, lat, lon FROM store_location WHERE store_id = ANY($1::uuid[])',
    [stores.map((s) => s.id)],
  );
  const sites = new Map(rows.map((r) => [r.store_id, { lat: Number(r.lat), lon: Number(r.lon) }]));
  return stores.map((s) => ({ ...s, site: sites.get(s.id) ?? null }));
}

/** Names of stores by id (any scope): a candidate's home store is shown by name (Req 12.5). */
export async function storeNames(db: Queryable, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { rows } = await db.query<{ id: string; name: string }>('SELECT id, name FROM store WHERE id = ANY($1::uuid[])', [ids]);
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Department options for the given stores: one per key, named by the first name seen. */
export async function listDepartmentOptions(db: Queryable, storeIds: readonly string[]): Promise<{ key: string; name: string }[]> {
  if (storeIds.length === 0) return [];
  const { rows } = await db.query<{ name: string }>(
    'SELECT DISTINCT name FROM department WHERE store_id = ANY($1::uuid[]) AND active ORDER BY name',
    [storeIds],
  );
  const out = new Map<string, string>();
  for (const r of rows) if (!out.has(departmentKey(r.name))) out.set(departmentKey(r.name), r.name);
  return [...out].map(([key, name]) => ({ key, name })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Shifts in local time
// ---------------------------------------------------------------------------

/** Local (Asia/Manila) ISO timestamp for `date` at `hour` (0–24). */
export function localInstant(date: string, hour: number): string {
  const day = new Date(`${date}T00:00:00${UTC_OFFSET}`);
  return new Date(day.getTime() + hour * 3_600_000).toISOString();
}

export interface LocalShiftRow {
  id: string;
  staff_id: string | null;
  store_id: string;
  department_name: string;
  local_date: string;
  local_hour: string;
  hours: string;
}

export const LOCAL_SHIFT_COLUMNS = `s.id, s.staff_id, r.store_id, d.name AS department_name,
       to_char(s.starts_at AT TIME ZONE '${STORE_TIME_ZONE}', 'YYYY-MM-DD') AS local_date,
       (extract(hour FROM s.starts_at AT TIME ZONE '${STORE_TIME_ZONE}')
        + extract(minute FROM s.starts_at AT TIME ZONE '${STORE_TIME_ZONE}') / 60.0)::text AS local_hour,
       (extract(epoch FROM s.ends_at - s.starts_at) / 3600.0)::text AS hours`;

export function toWorkShift(r: LocalShiftRow): WorkShift {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const startHour = round2(Number(r.local_hour));
  return { shiftId: r.id, storeId: r.store_id, date: r.local_date, startHour, endHour: round2(startHour + Number(r.hours)) };
}

export interface RosterShift extends WorkShift {
  readonly staffId: string | null;
  readonly departmentKey: string;
  readonly departmentName: string;
}

/**
 * Scheduled shifts on PUBLISHED rosters of the given stores that overlap
 * [from, to). Open shifts have `staffId` null.
 */
export async function listPublishedShifts(
  db: Queryable,
  options: { readonly storeIds: readonly string[]; readonly from: string; readonly to: string; readonly synthetic: boolean },
): Promise<RosterShift[]> {
  if (options.storeIds.length === 0) return [];
  const { rows } = await db.query<LocalShiftRow>(
    `SELECT ${LOCAL_SHIFT_COLUMNS}
       FROM shift s
       JOIN roster r ON r.id = s.roster_id AND r.status = 'published'
       JOIN department d ON d.id = s.department_id
      WHERE r.store_id = ANY($1::uuid[]) AND s.status = 'scheduled' AND s.synthetic = $2
        AND s.starts_at < $4::timestamptz AND s.ends_at > $3::timestamptz
      ORDER BY s.starts_at, s.id`,
    [options.storeIds, options.synthetic, options.from, options.to],
  );
  return rows.map((r) => ({ ...toWorkShift(r), staffId: r.staff_id, departmentKey: departmentKey(r.department_name), departmentName: r.department_name }));
}

// ---------------------------------------------------------------------------
// Candidates (consented staff only)
// ---------------------------------------------------------------------------

const CONTRACT: Readonly<Record<string, MatchCandidate['contractType']>> = { regular: 'FT', seasonal: 'FT', part_time: 'PT' };

export interface CandidateRecord extends MatchCandidate {
  readonly displayId: string;
  readonly barangayCode: string;
}

/**
 * Matching input for every consenting, active staff member of one provenance:
 * home area (barangay/city) from `home_area_matchable`, trained department
 * keys, unavailable dates around `date`, and their shifts at ANY store within
 * a week either side (weekly hours, rest and consecutive days, P16).
 */
export async function listMatchCandidates(
  db: Queryable,
  options: { readonly synthetic: boolean; readonly date: string },
): Promise<CandidateRecord[]> {
  const { rows: staff } = await db.query<{
    staff_id: string;
    home_store_id: string;
    employee_no: string;
    employment_type: string;
    home_department: string;
    barangay_code: string;
    barangay_name: string;
    barangay_city: string;
    consent_at: Date;
    max_travel_min: number;
    cross_store_offers: boolean;
  }>(
    `SELECT h.staff_id, h.home_store_id, s.employee_no, s.employment_type, d.name AS home_department,
            h.barangay_code, h.barangay_name, h.barangay_city, h.consent_at, h.max_travel_min, h.cross_store_offers
       FROM home_area_matchable h
       JOIN staff s ON s.id = h.staff_id
       JOIN department d ON d.id = s.department_id
      WHERE h.synthetic = $1
      ORDER BY h.staff_id`,
    [options.synthetic],
  );
  if (staff.length === 0) return [];
  const ids = staff.map((s) => s.staff_id);
  const from = localInstant(options.date, -7 * 24);
  const to = localInstant(options.date, 8 * 24);

  const [training, availability, shifts, offers] = await Promise.all([
    db.query<{ staff_id: string; name: string }>(
      `SELECT t.staff_id, d.name FROM staff_training t JOIN department d ON d.id = t.department_id
        WHERE t.staff_id = ANY($1::uuid[])`,
      [ids],
    ),
    db.query<{ staff_id: string; day: string }>(
      `SELECT a.staff_id, to_char(g.day, 'YYYY-MM-DD') AS day
         FROM staff_availability a
        CROSS JOIN LATERAL generate_series(
               date_trunc('day', a.starts_at AT TIME ZONE '${STORE_TIME_ZONE}'),
               date_trunc('day', (a.ends_at - interval '1 second') AT TIME ZONE '${STORE_TIME_ZONE}'),
               interval '1 day') AS g(day)
        WHERE a.staff_id = ANY($1::uuid[]) AND a.kind = 'unavailable'
          AND a.starts_at < $3::timestamptz AND a.ends_at > $2::timestamptz`,
      [ids, from, to],
    ),
    db.query<LocalShiftRow>(
      `SELECT ${LOCAL_SHIFT_COLUMNS}
         FROM shift s
         JOIN roster r ON r.id = s.roster_id AND r.status = 'published'
         JOIN department d ON d.id = s.department_id
        WHERE s.staff_id = ANY($1::uuid[]) AND s.status = 'scheduled'
          AND s.starts_at < $3::timestamptz AND s.ends_at > $2::timestamptz
        ORDER BY s.starts_at, s.id`,
      [ids, from, to],
    ),
    db.query<{ staff_id: string; n: number }>(
      `SELECT staff_id, count(*)::int AS n FROM shift_offer
        WHERE staff_id = ANY($1::uuid[]) AND sent_at >= $2::timestamptz - interval '7 days' AND sent_at < $2::timestamptz
        GROUP BY staff_id`,
      [ids, localInstant(options.date, 0)],
    ),
  ]);

  const group = <T,>(rows: readonly T[], key: (r: T) => string) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return m;
  };
  const trainedBy = group(training.rows, (r) => r.staff_id);
  const unavailableBy = group(availability.rows, (r) => r.staff_id);
  const shiftsBy = group(shifts.rows, (r) => r.staff_id ?? '');
  const offersBy = new Map(offers.rows.map((r) => [r.staff_id, r.n]));

  return staff.map((s) => {
    const own = (shiftsBy.get(s.staff_id) ?? []).map(toWorkShift);
    const skills = [...new Set([departmentKey(s.home_department), ...(trainedBy.get(s.staff_id) ?? []).map((t) => departmentKey(t.name))])].sort();
    return {
      staffId: s.staff_id,
      displayId: s.employee_no,
      barangayCode: s.barangay_code,
      homeStoreId: s.home_store_id,
      contractType: CONTRACT[s.employment_type] ?? 'FT',
      skills,
      primaryDepartmentId: departmentKey(s.home_department),
      location: {
        homeArea: { barangay: s.barangay_name, city: s.barangay_city },
        consentAt: s.consent_at.toISOString(),
        withdrawnAt: null,
        maxTravelMin: s.max_travel_min,
        crossStoreOffers: s.cross_store_offers,
      },
      unavailableDates: [...new Set((unavailableBy.get(s.staff_id) ?? []).map((a) => a.day))].sort(),
      shifts: own,
      extraShiftsThisPeriod: own.filter((x) => x.storeId !== s.home_store_id).length,
      recentOffers: offersBy.get(s.staff_id) ?? 0,
    };
  });
}

/** Consenting staff counted per barangay (task 15 view), one provenance. */
export async function countConsentedByBarangay(
  db: Queryable,
  synthetic: boolean,
): Promise<{ code: string; name: string; city: string; count: number }[]> {
  const { rows } = await db.query<{ code: string; name: string; city: string; count: number }>(
    `SELECT barangay_code AS code, barangay_name AS name, barangay_city AS city, count(*)::int AS count
       FROM home_area_matchable WHERE synthetic = $1
      GROUP BY barangay_code, barangay_name, barangay_city
      ORDER BY barangay_city, barangay_name, barangay_code`,
    [synthetic],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Travel times
// ---------------------------------------------------------------------------

export interface TravelCell {
  readonly barangay: string;
  readonly city: string;
  readonly storeId: string;
  readonly minutes: number;
}

/** Precomputed barangay → store minutes (task 16.2 matrix) for one mode and window. */
export async function listTravelTimes(
  db: Queryable,
  options: { readonly barangayCodes: readonly string[]; readonly storeIds: readonly string[]; readonly mode: TravelMode; readonly window: string },
): Promise<TravelCell[]> {
  if (options.barangayCodes.length === 0 || options.storeIds.length === 0) return [];
  const { rows } = await db.query<{ name: string; city: string; store_id: string; minutes: string }>(
    `SELECT b.name, b.city, t.store_id, t.minutes::text AS minutes
       FROM travel_time t JOIN barangay b ON b.psgc_code = t.barangay_code
      WHERE t.barangay_code = ANY($1::text[]) AND t.store_id = ANY($2::uuid[]) AND t.mode = $3 AND t.time_window = $4`,
    [options.barangayCodes, options.storeIds, options.mode, options.window.replace(/-/g, '_')],
  );
  return rows.map((r) => ({ barangay: r.name, city: r.city, storeId: r.store_id, minutes: Number(r.minutes) }));
}

const HAVERSINE_KM = (lat1: string, lon1: string, lat2: string, lon2: string) =>
  `(2 * 6371 * asin(sqrt(
      power(sin(radians((${lat2} - ${lat1}) / 2)), 2)
      + cos(radians(${lat1})) * cos(radians(${lat2})) * power(sin(radians((${lon2} - ${lon1}) / 2)), 2))))`;

/**
 * Straight-line km from each barangay's public centroid to each store site,
 * computed in the database: only the distance is returned (P15).
 */
export async function barangayStoreKm(
  db: Queryable,
  options: { readonly barangayCodes: readonly string[]; readonly storeIds: readonly string[] },
): Promise<{ barangay: string; city: string; storeId: string; km: number }[]> {
  if (options.barangayCodes.length === 0 || options.storeIds.length === 0) return [];
  const { rows } = await db.query<{ name: string; city: string; store_id: string; km: string }>(
    `SELECT b.name, b.city, l.store_id,
            round(${HAVERSINE_KM('b.centroid_lat', 'b.centroid_lon', 'l.lat', 'l.lon')}::numeric, 1)::text AS km
       FROM barangay b CROSS JOIN store_location l
      WHERE b.psgc_code = ANY($1::text[]) AND l.store_id = ANY($2::uuid[])`,
    [options.barangayCodes, options.storeIds],
  );
  return rows.map((r) => ({ barangay: r.name, city: r.city, storeId: r.store_id, km: Number(r.km) }));
}

/** Straight-line km between store sites (store-to-store moves). */
export async function storeStoreKm(db: Queryable, storeIds: readonly string[]): Promise<Map<string, number>> {
  if (storeIds.length < 2) return new Map();
  const { rows } = await db.query<{ a: string; b: string; km: string }>(
    `SELECT x.store_id AS a, y.store_id AS b,
            round(${HAVERSINE_KM('x.lat', 'x.lon', 'y.lat', 'y.lon')}::numeric, 1)::text AS km
       FROM store_location x JOIN store_location y ON x.store_id <> y.store_id
      WHERE x.store_id = ANY($1::uuid[]) AND y.store_id = ANY($1::uuid[])`,
    [storeIds],
  );
  return new Map(rows.map((r) => [`${r.a}|${r.b}`, Number(r.km)]));
}
