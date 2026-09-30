/**
 * Global search queries (task 20; design.md › Search and filter; P1, P11).
 *
 * Each group filters by the active role's scope in SQL, so out-of-scope rows
 * never leave the database; the route re-checks every hit. Matching is a
 * case-insensitive substring match with LIKE wildcards escaped, so `%` and
 * `_` in the query match literally. `total` counts every in-scope match;
 * `items` is the first `limit` of them by name.
 */
import type {
  ScenarioStatus,
  Scope,
  SearchDepartmentHit,
  SearchGroup,
  SearchScenarioHit,
  SearchStaffHit,
  SearchStoreHit,
  StoreFormat,
} from '@lanewise/shared';
import type pg from 'pg';
import type { Queryable } from '../pool.js';

export interface SearchOptions {
  readonly query: string;
  readonly limit: number;
}

/** `%needle%` with LIKE metacharacters escaped (the default escape is `\`). */
export function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * SQL predicate limiting `store` rows (aliased `alias`) to a scope, with its
 * values starting at `$<offset>`. `null` when the scope sees no store-wide
 * data (Staff, P11).
 */
function storeScopeSql(scope: Scope, alias: string, offset: number): { sql: string; values: unknown[] } | null {
  switch (scope.type) {
    case 'global':
      return { sql: 'true', values: [] };
    case 'region':
      return { sql: `${alias}.region_id = ANY($${offset}::uuid[])`, values: [scope.regionIds] };
    case 'store':
      return { sql: `${alias}.id = ANY($${offset}::uuid[])`, values: [scope.storeIds] };
    case 'self':
      return null;
  }
}

type Counted<R> = R & { total: string } & pg.QueryResultRow;

function group<R extends pg.QueryResultRow, T>(rows: readonly Counted<R>[], map: (row: R) => T): SearchGroup<T> {
  return { total: rows.length > 0 ? Number(rows[0]?.total) : 0, items: rows.map(map) };
}

const EMPTY: SearchGroup<never> = { total: 0, items: [] };

interface StoreRow extends pg.QueryResultRow {
  id: string;
  code: string;
  name: string;
  format: StoreFormat;
  region_id: string;
  region_name: string;
}

export async function searchStores(db: Queryable, scope: Scope, options: SearchOptions): Promise<SearchGroup<SearchStoreHit>> {
  const where = storeScopeSql(scope, 's', 3);
  if (!where) return EMPTY;
  const { rows } = await db.query<Counted<StoreRow>>(
    `SELECT s.id, s.code, s.name, s.format, s.region_id, r.name AS region_name, count(*) OVER () AS total
       FROM store s JOIN region r ON r.id = s.region_id
      WHERE (${where.sql})
        AND (s.name ILIKE $1 OR s.code ILIKE $1 OR r.name ILIKE $1)
      ORDER BY s.name, s.code
      LIMIT $2`,
    [likePattern(options.query), options.limit, ...where.values],
  );
  return group(rows, (r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    format: r.format,
    regionId: r.region_id,
    regionName: r.region_name,
  }));
}

interface DepartmentRow extends pg.QueryResultRow {
  id: string;
  name: string;
  store_id: string;
  store_name: string;
}

export async function searchDepartments(
  db: Queryable,
  scope: Scope,
  options: SearchOptions,
): Promise<SearchGroup<SearchDepartmentHit>> {
  const where = storeScopeSql(scope, 's', 3);
  if (!where) return EMPTY;
  const { rows } = await db.query<Counted<DepartmentRow>>(
    `SELECT d.id, d.name, d.store_id, s.name AS store_name, count(*) OVER () AS total
       FROM department d JOIN store s ON s.id = d.store_id
      WHERE (${where.sql})
        AND (d.name ILIKE $1 OR s.name ILIKE $1)
      ORDER BY s.name, d.name
      LIMIT $2`,
    [likePattern(options.query), options.limit, ...where.values],
  );
  return group(rows, (r) => ({ id: r.id, name: r.name, storeId: r.store_id, storeName: r.store_name }));
}

interface ScenarioRow extends pg.QueryResultRow {
  id: string;
  name: string;
  season: string;
  status: ScenarioStatus;
}

/**
 * Scenarios are network-wide plans, so any non-Staff scope may find them;
 * `publishedOnly` applies "V (published only)" (Store Manager).
 */
export async function searchScenarios(
  db: Queryable,
  scope: Scope,
  options: SearchOptions & { readonly publishedOnly: boolean },
): Promise<SearchGroup<SearchScenarioHit>> {
  if (scope.type === 'self') return EMPTY;
  const { rows } = await db.query<Counted<ScenarioRow>>(
    `SELECT id, name, season, status, count(*) OVER () AS total
       FROM scenario
      WHERE (name ILIKE $1 OR season ILIKE $1)
        AND (NOT $3::boolean OR status = 'published')
      ORDER BY name
      LIMIT $2`,
    [likePattern(options.query), options.limit, options.publishedOnly],
  );
  return group(rows, (r) => ({ id: r.id, name: r.name, season: r.season, status: r.status }));
}

interface StaffRow extends pg.QueryResultRow {
  id: string;
  name: string;
  employee_no: string;
  store_id: string;
  store_name: string;
  department_name: string;
}

/** Staff records by the record's store; a `self` scope finds at most the caller's own record (P11). */
export async function searchStaff(db: Queryable, scope: Scope, options: SearchOptions): Promise<SearchGroup<SearchStaffHit>> {
  const where =
    scope.type === 'self'
      ? { sql: 'st.id = $3::uuid', values: [scope.staffId] }
      : storeScopeSql(scope, 's', 3);
  if (!where) return EMPTY;
  const { rows } = await db.query<Counted<StaffRow>>(
    `SELECT st.id, st.name, st.employee_no, st.store_id, s.name AS store_name, d.name AS department_name,
            count(*) OVER () AS total
       FROM staff st
       JOIN store s ON s.id = st.store_id
       JOIN department d ON d.id = st.department_id
      WHERE (${where.sql})
        AND (st.name ILIKE $1 OR st.employee_no ILIKE $1 OR s.name ILIKE $1)
      ORDER BY st.name, st.employee_no
      LIMIT $2`,
    [likePattern(options.query), options.limit, ...where.values],
  );
  return group(rows, (r) => ({
    id: r.id,
    name: r.name,
    employeeNo: r.employee_no,
    storeId: r.store_id,
    storeName: r.store_name,
    departmentName: r.department_name,
  }));
}
