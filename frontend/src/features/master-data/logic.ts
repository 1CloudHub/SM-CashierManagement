import {
  AVAILABILITY_WINDOWS,
  FULL_AVAILABILITY,
  TOTAL_AVAILABILITY_WINDOWS,
  WEEKDAYS,
  availableWindowCount,
  can,
  type AvailabilityWindow,
  type DatasetType,
  type RoleCode,
  type StoreFormat,
  type StoreWithDepartments,
  type WeeklyAvailability,
  type Weekday,
} from '@lanewise/shared'
import { ApiError } from '@/api'

/** SCR-051 upload, pre-set to a dataset (the upload screen reads `?dataset=`). */
export function importHref(dataset: DatasetType): string {
  return `/data/upload?dataset=${dataset}`
}

/** Only a role that can load data (Rules Steward) is offered the SCR-051 import. */
export function canImport(role: RoleCode | null): boolean {
  return can(role, 'data_ingestion', 'manage')
}

/** Tablet width and up (design breakpoint `tablet`, 600px): editing is allowed. */
export const TABLET_UP = '(min-width: 37.5rem)'

export type LoadState<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly referenceId?: string }
  | { readonly kind: 'no-access' }
  | { readonly kind: 'ready'; readonly data: T }

/** Maps a failed load to its state: 403 → no access, anything else → error with its reference. */
export function failedLoad<T>(error: unknown): LoadState<T> {
  if (error instanceof ApiError && error.status === 403) return { kind: 'no-access' }
  return { kind: 'error', ...(error instanceof ApiError && error.requestId ? { referenceId: error.requestId } : {}) }
}

export interface StoreFilters {
  readonly q: string
  readonly regionId: string
  readonly format: StoreFormat | ''
}

export const NO_STORE_FILTERS: StoreFilters = { q: '', regionId: '', format: '' }

/**
 * Stores matching the filters. A search matches the store (name or code) or
 * any of its departments; a store matched only by a department shows just the
 * matching departments.
 */
export function filterStores(stores: readonly StoreWithDepartments[], filters: StoreFilters): StoreWithDepartments[] {
  const needle = filters.q.trim().toLowerCase()
  const out: StoreWithDepartments[] = []
  for (const store of stores) {
    if (filters.regionId && store.regionId !== filters.regionId) continue
    if (filters.format && store.format !== filters.format) continue
    if (needle.length === 0 || store.name.toLowerCase().includes(needle) || store.code.toLowerCase().includes(needle)) {
      out.push(store)
      continue
    }
    const departments = store.departments.filter((d) => d.name.toLowerCase().includes(needle))
    if (departments.length > 0) out.push({ ...store, departments })
  }
  return out
}

/** Summary of a weekly pattern for the table: any time, not available, or n of 21 windows. */
export type AvailabilitySummary =
  | { readonly kind: 'any' }
  | { readonly kind: 'none' }
  | { readonly kind: 'partial'; readonly windows: number; readonly total: number; readonly days: readonly Weekday[] }

export function summarizeAvailability(availability: WeeklyAvailability): AvailabilitySummary {
  const windows = availableWindowCount(availability)
  if (windows === TOTAL_AVAILABILITY_WINDOWS) return { kind: 'any' }
  if (windows === 0) return { kind: 'none' }
  return { kind: 'partial', windows, total: TOTAL_AVAILABILITY_WINDOWS, days: WEEKDAYS.filter((d) => availability[d].length > 0) }
}

export function toggleWindow(availability: WeeklyAvailability, day: Weekday, window: AvailabilityWindow): WeeklyAvailability {
  const current = availability[day]
  const next = current.includes(window) ? current.filter((w) => w !== window) : [...current, window]
  return { ...availability, [day]: AVAILABILITY_WINDOWS.filter((w) => next.includes(w)) }
}

export function sameAvailability(a: WeeklyAvailability, b: WeeklyAvailability): boolean {
  return WEEKDAYS.every((d) => a[d].length === b[d].length && a[d].every((w, i) => b[d][i] === w))
}

export { FULL_AVAILABILITY }

/** `YYYY-MM-DD` → a Date at UTC midnight (format it with `timeZone: 'UTC'`). */
export function dateOnly(date: string): Date {
  return new Date(`${date}T00:00:00Z`)
}

/** `HH:MM` → a Date at that UTC clock time (format it with `timeZone: 'UTC'`). */
export function clockTime(hhmm: string): Date {
  const [h = '0', m = '0'] = hhmm.split(':')
  return new Date(Date.UTC(2000, 0, 1, Number(h), Number(m)))
}

export const UTC_DATE: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeZone: 'UTC' }
export const UTC_TIME: Intl.DateTimeFormatOptions = { timeStyle: 'short', timeZone: 'UTC' }
