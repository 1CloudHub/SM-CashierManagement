/**
 * Location privacy and home-area consent (task 15; Req 12, P15; SEC-001).
 *
 * Every function here returns barangay-level data at most: barangay code,
 * name and city — never the barangay centroid, and nothing finer exists to
 * return. Mutations record exactly one audit event (P7); audit snapshots never
 * carry the barangay itself, because the audit log is immutable and kept for
 * 5 years while a staff member can withdraw their home area at any time.
 *
 * Map aggregation and matching inputs read only the `home_area_matchable`
 * view, which drops staff without an active, current consent (P15).
 */
import {
  CONSENT_LOCALES,
  type BarangayRef,
  type BarangayStaffCount,
  type ConsentLocale,
  type ConsentPurpose,
  type ConsentRecord,
  type ConsentStatus,
  type ConsentText,
  type ConsentWithdrawalReason,
  type HomeAreaSettings,
  type StaffHomeAreaResponse,
} from '@lanewise/shared';
import type pg from 'pg';
import { ApiError } from '../../http/errors.js';
import { audit, type AuditedTx } from '../audit.js';
import type { Queryable } from '../pool.js';
import { queryMaybe, queryOne } from '../rows.js';

/** Consent records (no location) are kept this long after withdrawal (SEC-001). */
export const CONSENT_RECORD_RETENTION_YEARS = 5;

const conflict = (message: string): ApiError => new ApiError('conflict', message);
const invalid = (path: string, message: string): ApiError =>
  new ApiError('validation_failed', 'Some fields are missing or invalid.', { details: [{ path, message }] });

// ---------------------------------------------------------------------------
// Staff linkage
// ---------------------------------------------------------------------------

export interface StaffRef {
  readonly id: string;
  readonly storeId: string;
  readonly regionId: string;
  readonly active: boolean;
  readonly synthetic: boolean;
}

interface StaffRefRow extends pg.QueryResultRow {
  id: string;
  store_id: string;
  region_id: string;
  active: boolean;
  synthetic: boolean;
}

const toStaffRef = (r: StaffRefRow): StaffRef => ({
  id: r.id,
  storeId: r.store_id,
  regionId: r.region_id,
  active: r.active,
  synthetic: r.synthetic,
});

const STAFF_REF_SQL = `SELECT s.id, s.store_id, st.region_id, s.active, s.synthetic
                         FROM staff s JOIN store st ON st.id = s.store_id`;

export async function getStaffRef(db: Queryable, staffId: string): Promise<StaffRef | null> {
  const row = await queryMaybe<StaffRefRow>(db, `${STAFF_REF_SQL} WHERE s.id = $1`, [staffId]);
  return row && toStaffRef(row);
}

// ---------------------------------------------------------------------------
// Consent text and status
// ---------------------------------------------------------------------------

interface ConsentTextRow extends pg.QueryResultRow {
  purpose: ConsentPurpose;
  version: number;
  locale: ConsentLocale;
  body: string;
  effective_from: Date;
}

const toConsentText = (r: ConsentTextRow): ConsentText => ({
  purpose: r.purpose,
  version: r.version,
  locale: r.locale,
  body: r.body,
  effectiveFrom: r.effective_from.toISOString(),
});

/** Latest version in force for `purpose` (0 when none is published). */
export async function currentConsentVersion(db: Queryable, purpose: ConsentPurpose): Promise<number> {
  const row = await queryOne<{ v: number }>(
    db,
    `SELECT coalesce(max(version), 0)::int AS v FROM consent_text WHERE purpose = $1 AND effective_from <= now()`,
    [purpose],
  );
  return row.v;
}

/** Oldest version whose grants still count (the latest `requires_reconsent` version in force). */
async function minimumValidVersion(db: Queryable, purpose: ConsentPurpose): Promise<number> {
  const row = await queryOne<{ v: number }>(
    db,
    `SELECT coalesce(max(version), 1)::int AS v FROM consent_text
      WHERE purpose = $1 AND requires_reconsent AND effective_from <= now()`,
    [purpose],
  );
  return row.v;
}

/** The current consent text in `locale`, falling back to English. */
export async function getCurrentConsentText(
  db: Queryable,
  purpose: ConsentPurpose,
  locale: ConsentLocale,
): Promise<ConsentText> {
  const version = await currentConsentVersion(db, purpose);
  const row = await queryMaybe<ConsentTextRow>(
    db,
    `SELECT purpose, version, locale, body, effective_from FROM consent_text
      WHERE purpose = $1 AND version = $2 AND locale IN ($3, 'en')
      ORDER BY (locale = $3) DESC LIMIT 1`,
    [purpose, version, locale],
  );
  if (!row) throw new Error(`no consent text published for ${purpose}`);
  return toConsentText(row);
}

interface ConsentRow extends pg.QueryResultRow {
  id: string;
  purpose: ConsentPurpose;
  text_version: number;
  text_locale: ConsentLocale;
  granted_at: Date;
  withdrawn_at: Date | null;
  withdrawal_reason: ConsentWithdrawalReason | null;
}

const CONSENT_COLUMNS = 'id, purpose, text_version, text_locale, granted_at, withdrawn_at, withdrawal_reason';

const toConsentRecord = (r: ConsentRow): ConsentRecord => ({
  id: r.id,
  purpose: r.purpose,
  textVersion: r.text_version,
  textLocale: r.text_locale,
  grantedAt: r.granted_at.toISOString(),
  withdrawnAt: r.withdrawn_at === null ? null : r.withdrawn_at.toISOString(),
  withdrawalReason: r.withdrawal_reason,
});

async function activeConsentRow(
  db: Queryable,
  staffId: string,
  purpose: ConsentPurpose,
  lock = false,
): Promise<ConsentRow | null> {
  return queryMaybe<ConsentRow>(
    db,
    `SELECT ${CONSENT_COLUMNS} FROM staff_consent
      WHERE staff_id = $1 AND purpose = $2 AND withdrawn_at IS NULL${lock ? ' FOR UPDATE' : ''}`,
    [staffId, purpose],
  );
}

export async function getConsentStatus(
  db: Queryable,
  staffId: string,
  purpose: ConsentPurpose,
): Promise<ConsentStatus> {
  // Sequential: `db` may be a single transaction client.
  const row = await activeConsentRow(db, staffId, purpose);
  const currentVersion = await currentConsentVersion(db, purpose);
  const minValid = await minimumValidVersion(db, purpose);
  const valid = row !== null && row.text_version >= minValid;
  return {
    purpose,
    active: valid,
    grantedVersion: row?.text_version ?? null,
    grantedAt: row ? row.granted_at.toISOString() : null,
    currentVersion,
    reconsentRequired: row !== null && !valid,
  };
}

/** Grants and withdrawals, newest first. */
export async function listConsentHistory(
  db: Queryable,
  staffId: string,
  purpose: ConsentPurpose,
): Promise<ConsentRecord[]> {
  const { rows } = await db.query<ConsentRow>(
    `SELECT ${CONSENT_COLUMNS} FROM staff_consent WHERE staff_id = $1 AND purpose = $2
      ORDER BY granted_at DESC, id`,
    [staffId, purpose],
  );
  return rows.map(toConsentRecord);
}

export interface GrantConsentInput {
  readonly staff: StaffRef;
  readonly purpose: ConsentPurpose;
  /** Must be the current text version: the one the staff member was shown. */
  readonly version: number;
  readonly locale: ConsentLocale;
}

/**
 * Records an opt-in consent (`consent.granted`). Re-granting to a newer text
 * version closes the previous grant in the same transaction without touching
 * the home area; granting the version already in force is a conflict.
 */
export async function grantConsent(tx: AuditedTx, input: GrantConsentInput): Promise<ConsentRecord> {
  if (!input.staff.active) throw conflict('This staff record is inactive.');
  if (!(CONSENT_LOCALES as readonly string[]).includes(input.locale)) {
    throw invalid('body.locale', 'Unsupported language.');
  }
  const current = await currentConsentVersion(tx, input.purpose);
  if (input.version !== current) {
    throw conflict('The consent text has changed. Read the current version and try again.');
  }
  const existing = await activeConsentRow(tx, input.staff.id, input.purpose, true);
  if (existing && existing.text_version === current) {
    throw conflict('You have already given this consent.');
  }
  // An older grant is superseded in the same statement, so the withdrawal
  // trigger sees the new grant and keeps the home area.
  const record = toConsentRecord(
    await queryOne<ConsentRow>(
      tx,
      existing
        ? `WITH closed AS (
             UPDATE staff_consent SET withdrawn_at = greatest(now(), granted_at), withdrawal_reason = 'superseded',
                                      withdrawn_by = $5
              WHERE id = $6 RETURNING staff_id)
           INSERT INTO staff_consent (staff_id, purpose, text_version, text_locale, granted_by, synthetic)
           SELECT $1, $2, $3, $4, $5, $7 FROM closed
           RETURNING ${CONSENT_COLUMNS}`
        : `INSERT INTO staff_consent (staff_id, purpose, text_version, text_locale, granted_by, synthetic)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING ${CONSENT_COLUMNS}`,
      existing
        ? [input.staff.id, input.purpose, current, input.locale, tx.actor.userId, existing.id, input.staff.synthetic]
        : [input.staff.id, input.purpose, current, input.locale, tx.actor.userId, input.staff.synthetic],
    ),
  );
  await audit.record(tx, {
    action: 'create',
    event: 'consent.granted',
    objectType: 'staff_consent',
    objectId: record.id,
    after: {
      staffId: input.staff.id,
      purpose: record.purpose,
      textVersion: record.textVersion,
      textLocale: record.textLocale,
      grantedAt: record.grantedAt,
      ...(existing ? { supersedes: existing.id } : {}),
    },
    synthetic: input.staff.synthetic,
  });
  return record;
}

/**
 * Withdraws the active consent (`consent.withdrawn`). For `home_area` the
 * database deletes the home area in the same transaction, so from commit the
 * staff member is off the map and out of matching (Req 12.3).
 */
export async function withdrawConsent(
  tx: AuditedTx,
  staff: StaffRef,
  purpose: ConsentPurpose,
): Promise<ConsentRecord> {
  const existing = await activeConsentRow(tx, staff.id, purpose, true);
  if (!existing) throw conflict('There is no consent to withdraw.');
  const hadHomeArea =
    (await queryMaybe(tx, 'SELECT 1 FROM staff_home_area WHERE staff_id = $1', [staff.id])) !== null;
  const record = toConsentRecord(
    await queryOne<ConsentRow>(
      tx,
      `UPDATE staff_consent
          SET withdrawn_at = greatest(now(), granted_at), withdrawn_by = $2, withdrawal_reason = 'staff_withdrew'
        WHERE id = $1 RETURNING ${CONSENT_COLUMNS}`,
      [existing.id, tx.actor.userId],
    ),
  );
  await audit.record(tx, {
    action: 'edit',
    event: 'consent.withdrawn',
    objectType: 'staff_consent',
    objectId: record.id,
    before: { staffId: staff.id, purpose, textVersion: record.textVersion, withdrawnAt: null, homeAreaShared: hadHomeArea },
    after: { staffId: staff.id, purpose, textVersion: record.textVersion, withdrawnAt: record.withdrawnAt, homeAreaShared: false },
    synthetic: staff.synthetic,
  });
  return record;
}

// ---------------------------------------------------------------------------
// Barangay reference list
// ---------------------------------------------------------------------------

interface BarangayRow extends pg.QueryResultRow {
  psgc_code: string;
  name: string;
  city: string;
}

const toBarangayRef = (r: BarangayRow): BarangayRef => ({ code: r.psgc_code, name: r.name, city: r.city });

export interface BarangaySearch {
  readonly q?: string;
  readonly city?: string;
  /** Default 20, max 50. */
  readonly limit?: number;
}

/** Searches the PSGC barangay list by name (and optionally city). Never returns coordinates. */
export async function searchBarangays(db: Queryable, search: BarangaySearch): Promise<BarangayRef[]> {
  const values: unknown[] = [];
  const where: string[] = [];
  if (search.q !== undefined && search.q.trim().length > 0) {
    values.push(`%${search.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`(name ILIKE $${values.length} OR psgc_code LIKE $${values.length})`);
  }
  if (search.city !== undefined && search.city.trim().length > 0) {
    values.push(search.city.trim());
    where.push(`city ILIKE $${values.length}`);
  }
  values.push(Math.min(Math.max(search.limit ?? 20, 1), 50));
  const { rows } = await db.query<BarangayRow>(
    `SELECT psgc_code, name, city FROM barangay
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY city, name, psgc_code LIMIT $${values.length}`,
    values,
  );
  return rows.map(toBarangayRef);
}

// ---------------------------------------------------------------------------
// Home area (own)
// ---------------------------------------------------------------------------

interface HomeAreaRow extends pg.QueryResultRow {
  barangay_code: string;
  barangay_name: string;
  barangay_city: string;
  max_travel_min: number;
  cross_store_offers: boolean;
  updated_at: Date;
}

const toSettings = (r: HomeAreaRow): HomeAreaSettings => ({
  barangay: { code: r.barangay_code, name: r.barangay_name, city: r.barangay_city },
  maxTravelMin: r.max_travel_min,
  crossStoreOffers: r.cross_store_offers,
  updatedAt: r.updated_at.toISOString(),
});

/**
 * The staff member's own home area, or null when not shared. Reads through
 * `home_area_matchable`, so a grant to an outdated text version reads as not
 * shared until the staff member consents again.
 */
export async function getOwnHomeArea(db: Queryable, staffId: string): Promise<HomeAreaSettings | null> {
  const row = await queryMaybe<HomeAreaRow>(
    db,
    `SELECT m.barangay_code, m.barangay_name, m.barangay_city, m.max_travel_min, m.cross_store_offers, h.updated_at
       FROM home_area_matchable m JOIN staff_home_area h ON h.staff_id = m.staff_id
      WHERE m.staff_id = $1`,
    [staffId],
  );
  return row && toSettings(row);
}

export interface SetHomeAreaInput {
  readonly barangayCode: string;
  readonly maxTravelMin: number;
  readonly crossStoreOffers: boolean;
}

/** Creates or replaces the home area (`home_area.set`). Requires an active, current consent. */
export async function setHomeArea(
  tx: AuditedTx,
  staff: StaffRef,
  input: SetHomeAreaInput,
): Promise<HomeAreaSettings> {
  const consent = await getConsentStatus(tx, staff.id, 'home_area');
  if (!consent.active) throw conflict('Agree to share your home area first.');
  const barangay = await queryMaybe<BarangayRow>(tx, 'SELECT psgc_code, name, city FROM barangay WHERE psgc_code = $1', [
    input.barangayCode,
  ]);
  if (!barangay) throw invalid('body.barangayCode', 'Choose a barangay from the list.');
  const before = await queryMaybe<{ max_travel_min: number; cross_store_offers: boolean }>(
    tx,
    'SELECT max_travel_min, cross_store_offers FROM staff_home_area WHERE staff_id = $1 FOR UPDATE',
    [staff.id],
  );
  const consentAt = consent.grantedAt;
  const { rows } = await tx.query<{ updated_at: Date }>(
    `INSERT INTO staff_home_area (staff_id, barangay_code, consent_at, max_travel_min, cross_store_offers, synthetic)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (staff_id) DO UPDATE
       SET barangay_code = EXCLUDED.barangay_code, consent_at = EXCLUDED.consent_at,
           max_travel_min = EXCLUDED.max_travel_min, cross_store_offers = EXCLUDED.cross_store_offers
     RETURNING updated_at`,
    [staff.id, input.barangayCode, consentAt, input.maxTravelMin, input.crossStoreOffers, staff.synthetic],
  );
  const updatedAt = rows[0]?.updated_at ?? new Date();
  // The barangay itself is deliberately not audited (see module comment).
  await audit.record(tx, {
    action: before ? 'edit' : 'create',
    event: 'home_area.set',
    objectType: 'staff_home_area',
    objectId: staff.id,
    ...(before
      ? { before: { maxTravelMin: before.max_travel_min, crossStoreOffers: before.cross_store_offers, shared: true } }
      : {}),
    after: { maxTravelMin: input.maxTravelMin, crossStoreOffers: input.crossStoreOffers, shared: true },
    synthetic: staff.synthetic,
  });
  return {
    barangay: toBarangayRef(barangay),
    maxTravelMin: input.maxTravelMin,
    crossStoreOffers: input.crossStoreOffers,
    updatedAt: updatedAt.toISOString(),
  };
}

/** Removes the home area but keeps the consent (`home_area.cleared`). */
export async function clearHomeArea(tx: AuditedTx, staff: StaffRef): Promise<void> {
  const { rows } = await tx.query<{ max_travel_min: number; cross_store_offers: boolean }>(
    'DELETE FROM staff_home_area WHERE staff_id = $1 RETURNING max_travel_min, cross_store_offers',
    [staff.id],
  );
  const before = rows[0];
  if (!before) throw conflict('There is no home area to remove.');
  await audit.record(tx, {
    action: 'edit',
    event: 'home_area.cleared',
    objectType: 'staff_home_area',
    objectId: staff.id,
    before: { maxTravelMin: before.max_travel_min, crossStoreOffers: before.cross_store_offers, shared: true },
    after: { shared: false },
    synthetic: staff.synthetic,
  });
}

// ---------------------------------------------------------------------------
// Manager / HR view (SCR-053)
// ---------------------------------------------------------------------------

/** One staff member's home area at barangay level, or `shared: false`. */
export async function getStaffHomeArea(db: Queryable, staffId: string): Promise<StaffHomeAreaResponse> {
  const row = await queryMaybe<HomeAreaRow>(
    db,
    `SELECT barangay_code, barangay_name, barangay_city, max_travel_min, cross_store_offers, now() AS updated_at
       FROM home_area_matchable WHERE staff_id = $1`,
    [staffId],
  );
  if (!row) return { staffId, shared: false };
  return {
    staffId,
    shared: true,
    barangay: { code: row.barangay_code, name: row.barangay_name, city: row.barangay_city },
    maxTravelMin: row.max_travel_min,
    crossStoreOffers: row.cross_store_offers,
  };
}

// ---------------------------------------------------------------------------
// Map aggregation and matching inputs (read by task 16)
// ---------------------------------------------------------------------------

export interface HomeAreaFilter {
  /** Restrict to staff whose home store is one of these (scope). */
  readonly homeStoreIds?: readonly string[];
  /** Restrict to these staff. */
  readonly staffIds?: readonly string[];
  /** Provenance of the run (P18): demo and real data are never mixed. */
  readonly synthetic?: boolean;
  /** Only staff who accept offers from other stores. */
  readonly crossStoreOnly?: boolean;
}

function filterSql(filter: HomeAreaFilter): { where: string; values: unknown[] } {
  const values: unknown[] = [];
  const where: string[] = [];
  if (filter.homeStoreIds !== undefined) {
    values.push(filter.homeStoreIds);
    where.push(`home_store_id = ANY($${values.length}::uuid[])`);
  }
  if (filter.staffIds !== undefined) {
    values.push(filter.staffIds);
    where.push(`staff_id = ANY($${values.length}::uuid[])`);
  }
  if (filter.synthetic !== undefined) {
    values.push(filter.synthetic);
    where.push(`synthetic = $${values.length}`);
  }
  if (filter.crossStoreOnly === true) where.push('cross_store_offers');
  return { where: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '', values };
}

export interface AggregateOptions extends HomeAreaFilter {
  /**
   * Barangays with fewer consenting staff than this are left out, so a count
   * of one cannot single a person out on a planner's map. Default 1.
   */
  readonly minCount?: number;
}

/**
 * Consenting staff counted per barangay — the only home-area view planners
 * get (map layer "available cashiers by home area"). No staff ids.
 */
export async function aggregateHomeAreasByBarangay(
  db: Queryable,
  options: AggregateOptions = {},
): Promise<BarangayStaffCount[]> {
  const { where, values } = filterSql(options);
  values.push(Math.max(options.minCount ?? 1, 1));
  const { rows } = await db.query<BarangayRow & { count: number }>(
    `SELECT barangay_code AS psgc_code, barangay_name AS name, barangay_city AS city, count(*)::int AS count
       FROM home_area_matchable ${where}
      GROUP BY barangay_code, barangay_name, barangay_city
     HAVING count(*) >= $${values.length}
      ORDER BY barangay_city, barangay_name, barangay_code`,
    values,
  );
  return rows.map((r) => ({ barangay: toBarangayRef(r), count: r.count }));
}

/**
 * Matching input for `@lanewise/matching` (its `HomeAreaConsent` shape):
 * consenting staff only, barangay + city only. Staff without consent are not
 * returned at all, so they cannot reach the map or ranking.
 */
export interface MatchingHomeArea {
  readonly staffId: string;
  readonly homeStoreId: string;
  readonly location: {
    readonly homeArea: { readonly barangay: string; readonly city: string };
    readonly consentAt: string;
    readonly withdrawnAt: null;
    readonly maxTravelMin: number;
    readonly crossStoreOffers: boolean;
  };
}

export async function listMatchingHomeAreas(db: Queryable, filter: HomeAreaFilter = {}): Promise<MatchingHomeArea[]> {
  const { where, values } = filterSql(filter);
  const { rows } = await db.query<{
    staff_id: string;
    home_store_id: string;
    barangay_name: string;
    barangay_city: string;
    consent_at: Date;
    max_travel_min: number;
    cross_store_offers: boolean;
  }>(
    `SELECT staff_id, home_store_id, barangay_name, barangay_city, consent_at, max_travel_min, cross_store_offers
       FROM home_area_matchable ${where} ORDER BY staff_id`,
    values,
  );
  return rows.map((r) => ({
    staffId: r.staff_id,
    homeStoreId: r.home_store_id,
    location: {
      homeArea: { barangay: r.barangay_name, city: r.barangay_city },
      consentAt: r.consent_at.toISOString(),
      withdrawnAt: null,
      maxTravelMin: r.max_travel_min,
      crossStoreOffers: r.cross_store_offers,
    },
  }));
}

// ---------------------------------------------------------------------------
// Retention (SEC-001)
// ---------------------------------------------------------------------------

/**
 * Deletes consent records withdrawn more than 5 years before `now`
 * (`consent.retention_purged`, one event for the batch). Active grants are
 * never purged. Returns the number of records deleted.
 */
export async function purgeExpiredConsentRecords(tx: AuditedTx, now: Date): Promise<number> {
  const { rows } = await tx.query<{ id: string }>(
    `DELETE FROM staff_consent
      WHERE withdrawn_at IS NOT NULL AND withdrawn_at < $1::timestamptz - make_interval(years => $2)
      RETURNING id`,
    [now, CONSENT_RECORD_RETENTION_YEARS],
  );
  await audit.record(tx, {
    action: 'edit',
    event: 'consent.retention_purged',
    objectType: 'staff_consent',
    objectId: 'retention',
    after: { purged: rows.length, olderThanYears: CONSENT_RECORD_RETENTION_YEARS, at: now.toISOString() },
  });
  return rows.length;
}
