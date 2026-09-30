/**
 * Regions, stores and departments (DOM-002 Store, Department; SCR-052).
 */
import type { Department, Store, StoreFormat } from '@lanewise/shared';
import type pg from 'pg';
import { audit, type AuditedTx } from '../audit.js';
import type { Queryable } from '../pool.js';
import { queryMaybe, queryOne } from '../rows.js';

export interface Region {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly synthetic: boolean;
}

export async function createRegion(
  tx: AuditedTx,
  input: { code: string; name: string; synthetic?: boolean },
): Promise<Region> {
  const region = await queryOne<Region>(
    tx,
    'INSERT INTO region (code, name, synthetic) VALUES ($1, $2, $3) RETURNING id, code, name, synthetic',
    [input.code, input.name, input.synthetic ?? false],
  );
  await audit.record(tx, {
    action: 'create',
    event: 'region.created',
    objectType: 'region',
    objectId: region.id,
    after: { ...region },
    synthetic: region.synthetic,
  });
  return region;
}

interface StoreRow extends pg.QueryResultRow {
  id: string;
  code: string;
  name: string;
  format: StoreFormat;
  region_id: string;
  active: boolean;
  synthetic: boolean;
}

const STORE_COLUMNS = 'id, code, name, format, region_id, active, synthetic';

export interface StoreRecord extends Store {
  readonly code: string;
}

function toStore(row: StoreRow): StoreRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    format: row.format,
    regionId: row.region_id,
    active: row.active,
    synthetic: row.synthetic,
  };
}

export async function getStore(db: Queryable, id: string): Promise<StoreRecord | null> {
  const row = await queryMaybe<StoreRow>(db, `SELECT ${STORE_COLUMNS} FROM store WHERE id = $1`, [id]);
  return row && toStore(row);
}

export interface CreateStoreInput {
  readonly code: string;
  readonly name: string;
  readonly format: StoreFormat;
  readonly regionId: string;
  readonly synthetic?: boolean;
}

export async function createStore(tx: AuditedTx, input: CreateStoreInput): Promise<StoreRecord> {
  const store = toStore(
    await queryOne<StoreRow>(
      tx,
      `INSERT INTO store (code, name, format, region_id, synthetic) VALUES ($1, $2, $3, $4, $5)
       RETURNING ${STORE_COLUMNS}`,
      [input.code, input.name, input.format, input.regionId, input.synthetic ?? false],
    ),
  );
  await audit.record(tx, {
    action: 'create',
    event: 'store.created',
    objectType: 'store',
    objectId: store.id,
    after: { ...store },
    synthetic: store.synthetic,
  });
  return store;
}

export interface UpdateStoreInput {
  readonly name?: string;
  readonly format?: StoreFormat;
  readonly active?: boolean;
}

export async function updateStore(tx: AuditedTx, id: string, input: UpdateStoreInput): Promise<StoreRecord> {
  const before = toStore(
    await queryOne<StoreRow>(tx, `SELECT ${STORE_COLUMNS} FROM store WHERE id = $1 FOR UPDATE`, [id]),
  );
  const after = toStore(
    await queryOne<StoreRow>(
      tx,
      `UPDATE store SET name = coalesce($2, name), format = coalesce($3, format), active = coalesce($4, active)
        WHERE id = $1 RETURNING ${STORE_COLUMNS}`,
      [id, input.name ?? null, input.format ?? null, input.active ?? null],
    ),
  );
  await audit.record(tx, {
    action: 'edit',
    event: 'store.updated',
    objectType: 'store',
    objectId: id,
    before: { ...before },
    after: { ...after },
    synthetic: after.synthetic,
  });
  return after;
}

interface DepartmentRow extends pg.QueryResultRow {
  id: string;
  store_id: string;
  name: string;
  installed_lanes: number;
  default_handle_time_min: string;
  trading_open: string;
  trading_close: string;
  synthetic: boolean;
}

const DEPARTMENT_COLUMNS =
  'id, store_id, name, installed_lanes, default_handle_time_min, trading_open, trading_close, synthetic';

function toDepartment(row: DepartmentRow): Department {
  return {
    id: row.id,
    storeId: row.store_id,
    name: row.name,
    installedLanes: row.installed_lanes,
    defaultHandleTimeMin: Number(row.default_handle_time_min),
    tradingHours: { open: row.trading_open.slice(0, 5), close: row.trading_close.slice(0, 5) },
    synthetic: row.synthetic,
  };
}

export type CreateDepartmentInput = Omit<Department, 'id' | 'synthetic'>;

/** Creates a department; its provenance is its store's (P18). */
export async function createDepartment(tx: AuditedTx, input: CreateDepartmentInput): Promise<Department> {
  const department = toDepartment(
    await queryOne<DepartmentRow>(
      tx,
      `INSERT INTO department
         (store_id, name, installed_lanes, default_handle_time_min, trading_open, trading_close, synthetic)
       SELECT $1, $2, $3, $4, $5, $6, s.synthetic FROM store s WHERE s.id = $1
       RETURNING ${DEPARTMENT_COLUMNS}`,
      [
        input.storeId,
        input.name,
        input.installedLanes,
        input.defaultHandleTimeMin,
        input.tradingHours.open,
        input.tradingHours.close,
      ],
    ),
  );
  await audit.record(tx, {
    action: 'create',
    event: 'department.created',
    objectType: 'department',
    objectId: department.id,
    after: { ...department },
    synthetic: department.synthetic,
  });
  return department;
}
