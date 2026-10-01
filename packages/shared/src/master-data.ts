/**
 * Master data DTOs and helpers: stores, departments and lanes (SCR-052) and
 * staff with their availability (SCR-053). Shared by the API and the SPA.
 *
 * Staff names are personal data (RA 10173): the API only ever returns staff
 * inside the active role's scope (P1) and never anything finer than a
 * barangay about where a person lives (P15, handled by the location-privacy
 * routes).
 */
import type { IsoDate, StoreFormat, TradingHours } from './entities.js';

// ---------------------------------------------------------------------------
// Stores, departments, lanes (SCR-052)
// ---------------------------------------------------------------------------

export interface RegionSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/** A department (lane group) of a store, as listed and edited on SCR-052. */
export interface DepartmentSummary {
  readonly id: string;
  readonly storeId: string;
  readonly name: string;
  readonly installedLanes: number;
  /** Default average handle time per transaction, in minutes. */
  readonly defaultHandleTimeMin: number;
  readonly tradingHours: TradingHours;
  readonly active: boolean;
  readonly synthetic: boolean;
}

/** `POST /stores` request body (Rules Steward: master data manage). */
export interface CreateStoreRequest {
  readonly code: string;
  readonly name: string;
  readonly format: StoreFormat;
  readonly regionId: string;
}

/** `PATCH /stores/:storeId` request body. */
export interface UpdateStoreRequest {
  readonly name?: string;
  readonly format?: StoreFormat;
  readonly active?: boolean;
}

/** `PATCH /departments/:departmentId` request body. */
export interface UpdateDepartmentRequest {
  readonly name?: string;
  readonly installedLanes?: number;
  readonly defaultHandleTimeMin?: number;
  readonly tradingHours?: TradingHours;
  readonly active?: boolean;
}

/** `HH:MM` 24-hour clock time. */
export const CLOCK_TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export const MASTER_DATA_LIMITS = {
  codeMax: 40,
  nameMax: 120,
  installedLanesMax: 500,
  handleTimeMinMax: 60,
} as const;

/** Store-level roll-up for the grouped SCR-052 table. */
export function storeRollup(departments: readonly DepartmentSummary[]): {
  readonly installedLanes: number;
  readonly tradingHours: TradingHours | null;
} {
  const active = departments.filter((d) => d.active);
  const installedLanes = active.reduce((n, d) => n + d.installedLanes, 0);
  if (active.length === 0) return { installedLanes, tradingHours: null };
  const open = active.map((d) => d.tradingHours.open).sort()[0] ?? '';
  const close = active.map((d) => d.tradingHours.close).sort().at(-1) ?? '';
  return { installedLanes, tradingHours: { open, close } };
}

// ---------------------------------------------------------------------------
// Staff and availability (SCR-053)
// ---------------------------------------------------------------------------

/**
 * Staff types shown on SCR-053. They map onto the DOM-002 employment types
 * (`regular`, `part_time`, `seasonal`); float and seasonal cashiers are both
 * `seasonal` employment and are told apart by the contract type kept in the
 * weekly pattern (as the HRIS import does).
 */
export const STAFF_TYPES = ['full_time', 'part_time', 'float', 'seasonal'] as const;
export type StaffType = (typeof STAFF_TYPES)[number];

export const EMPLOYMENT_TYPES = ['regular', 'part_time', 'seasonal'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYMENT_TYPE_BY_STAFF_TYPE: Readonly<Record<StaffType, EmploymentType>> = {
  full_time: 'regular',
  part_time: 'part_time',
  float: 'seasonal',
  seasonal: 'seasonal',
};

/** Contract type stored in `weekly_pattern.contractType` (HRIS import vocabulary). */
export const CONTRACT_TYPE_BY_STAFF_TYPE: Readonly<Record<StaffType, string>> = {
  full_time: 'FT',
  part_time: 'PT',
  float: 'FLOAT',
  seasonal: 'SEASONAL',
};

/** The staff type of a record from its employment type and stored contract type. */
export function staffTypeOf(employmentType: EmploymentType, contractType: unknown): StaffType {
  for (const type of STAFF_TYPES) {
    if (CONTRACT_TYPE_BY_STAFF_TYPE[type] === contractType && EMPLOYMENT_TYPE_BY_STAFF_TYPE[type] === employmentType) {
      return type;
    }
  }
  return employmentType === 'regular' ? 'full_time' : employmentType === 'part_time' ? 'part_time' : 'seasonal';
}

/** Days of the week, Monday first (the order SCR-053 shows them in). */
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** `staff.preferred_rest_day` numbering: 0 = Sunday … 6 = Saturday. */
export function weekdayToDow(day: Weekday): number {
  return (WEEKDAYS.indexOf(day) + 1) % 7;
}

export function dowToWeekday(dow: number): Weekday | null {
  if (!Number.isInteger(dow) || dow < 0 || dow > 6) return null;
  return WEEKDAYS[(dow + 6) % 7] ?? null;
}

/**
 * Time windows of the weekly availability grid: morning (store opening to
 * 12:00), afternoon (12:00–17:00) and evening (17:00 to closing).
 */
export const AVAILABILITY_WINDOWS = ['morning', 'afternoon', 'evening'] as const;
export type AvailabilityWindow = (typeof AVAILABILITY_WINDOWS)[number];

/** For each day, the windows the person is available in (empty = not available that day). */
export type WeeklyAvailability = Readonly<Record<Weekday, readonly AvailabilityWindow[]>>;

/** Available in every window of every day — the default when nothing is recorded. */
export const FULL_AVAILABILITY: WeeklyAvailability = Object.fromEntries(
  WEEKDAYS.map((d) => [d, [...AVAILABILITY_WINDOWS]]),
) as unknown as WeeklyAvailability;

/**
 * Reads a stored weekly availability pattern defensively: unknown days and
 * windows are dropped, duplicates removed and windows put in grid order. A
 * missing pattern means "any time".
 */
export function normalizeAvailability(raw: unknown): WeeklyAvailability {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return FULL_AVAILABILITY;
  const source = raw as Record<string, unknown>;
  const out = {} as Record<Weekday, AvailabilityWindow[]>;
  for (const day of WEEKDAYS) {
    const value = source[day];
    out[day] = Array.isArray(value)
      ? AVAILABILITY_WINDOWS.filter((w) => value.includes(w))
      : [...AVAILABILITY_WINDOWS];
  }
  return out;
}

/** Number of available windows in the week (0–21). */
export function availableWindowCount(availability: WeeklyAvailability): number {
  return WEEKDAYS.reduce((n, d) => n + availability[d].length, 0);
}

export const TOTAL_AVAILABILITY_WINDOWS = WEEKDAYS.length * AVAILABILITY_WINDOWS.length;

export const UNAVAILABLE_SOURCES = ['manual', 'staff_request', 'import'] as const;
export type UnavailableSource = (typeof UNAVAILABLE_SOURCES)[number];

/** A day the person can't work (on top of the weekly pattern). */
export interface StaffUnavailableDate {
  readonly id: string;
  readonly date: IsoDate;
  readonly reason: string | null;
  /** Only `manual` entries can be removed on SCR-053. */
  readonly source: UnavailableSource;
}

/** A staff record as listed on SCR-053 (and returned by `GET /staff/:staffId`). */
export interface StaffRecord {
  readonly id: string;
  readonly employeeNo: string;
  readonly name: string;
  readonly type: StaffType;
  readonly storeId: string;
  readonly storeName: string;
  readonly departmentId: string;
  readonly departmentName: string;
  readonly preferredRestDay: Weekday | null;
  readonly availability: WeeklyAvailability;
  /** Upcoming unavailable dates, earliest first. */
  readonly unavailableDates: readonly StaffUnavailableDate[];
  readonly active: boolean;
  readonly synthetic: boolean;
}

/** `GET /staff` — only staff in the active role's scope (P1). */
export interface StaffListResponse {
  readonly staff: readonly StaffRecord[];
  /** True when more records match than the list returns; narrow the filters. */
  readonly truncated: boolean;
}

/** `GET /staff` query: all optional. */
export interface StaffListQuery {
  readonly storeId?: string;
  readonly departmentId?: string;
  readonly type?: StaffType;
  /** Matches name or staff ID (case-insensitive substring). */
  readonly q?: string;
}

export const STAFF_LIST_LIMIT = 500;
export const STAFF_LIMITS = { employeeNoMax: 40, nameMax: 120, reasonMax: 200, queryMax: 80 } as const;

/** `POST /staff` request body (HR: staff records manage). */
export interface CreateStaffRequest {
  readonly storeId: string;
  readonly departmentId: string;
  readonly employeeNo: string;
  readonly name: string;
  readonly type: StaffType;
  readonly preferredRestDay?: Weekday | null;
}

/** `PATCH /staff/:staffId` request body. */
export interface UpdateStaffRequest {
  readonly name?: string;
  readonly type?: StaffType;
  readonly departmentId?: string;
  readonly preferredRestDay?: Weekday | null;
  readonly active?: boolean;
}

/** `PUT /staff/:staffId/availability` request body. */
export interface SetAvailabilityRequest {
  readonly availability: WeeklyAvailability;
}

/** `POST /staff/:staffId/unavailable-dates` request body. */
export interface AddUnavailableDateRequest {
  readonly date: IsoDate;
  readonly reason?: string;
}
