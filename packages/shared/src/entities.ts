/**
 * Core entity DTOs (design.md › Data Models; DOM-002 data dictionary).
 *
 * Fields are the indicative ones from the design; the relational schema
 * (task 5.1) is the source of truth for persistence. Timestamps are ISO-8601
 * strings on the wire.
 */
import type { RoleCode } from './roles.js';

/** ISO-8601 timestamp string, e.g. `2026-10-01T08:00:00.000Z`. */
export type IsoDateTime = string;
/** ISO-8601 calendar date, e.g. `2026-12-19`. */
export type IsoDate = string;

export const LANGUAGES = ['en', 'fil'] as const;
export type Language = (typeof LANGUAGES)[number];

/** `invited` until the first sign-in (SCR-071); `disabled` once deactivated (SCR-070). */
export const USER_STATUSES = ['invited', 'active', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface User {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly status: UserStatus;
  readonly lastSignIn: IsoDateTime | null;
  /** Active role (demo role switcher, task 8.2); always re-authorised server-side. */
  readonly activeRole: RoleCode | null;
  readonly language: Language;
}

/** Store formats in scope (Q26). */
export const STORE_FORMATS = ['sm_supermarket', 'sm_hypermarket', 'savemore', 'sm_store'] as const;
export type StoreFormat = (typeof STORE_FORMATS)[number];

export interface Store {
  readonly id: string;
  readonly name: string;
  readonly format: StoreFormat;
  readonly regionId: string;
  readonly active: boolean;
  /** Seeded demo record (P18); never mixed with real records in one snapshot. */
  readonly synthetic: boolean;
}

/** Daily trading window in local store time, `HH:MM` 24-hour. */
export interface TradingHours {
  readonly open: string;
  readonly close: string;
}

export interface Department {
  readonly id: string;
  readonly storeId: string;
  readonly name: string;
  readonly installedLanes: number;
  /** Default average handle time per transaction, in minutes. */
  readonly defaultHandleTimeMin: number;
  readonly tradingHours: TradingHours;
  readonly synthetic: boolean;
}

export const DATASET_TYPES = ['pos', 'master', 'staff'] as const;
export type DatasetType = (typeof DATASET_TYPES)[number];

export interface DatasetSnapshot {
  readonly id: string;
  readonly type: DatasetType;
  readonly coversFrom: IsoDate;
  readonly coversTo: IsoDate;
  readonly rowCount: number;
  readonly synthetic: boolean;
  readonly loadedAt: IsoDateTime;
}
