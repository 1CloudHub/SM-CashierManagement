/**
 * Pure helpers for the planning screens (task 14): URL view state → API
 * queries, heatmap pressure bands, sorting and links between screens.
 */
import { decodeViewState, encodeViewState, type MilestoneStatus, type NetworkStoreRow, type ViewState } from '@lanewise/shared'
import type { StatusTone } from '@/components/ui'
import type { NetworkQuery } from './api'

/** The network query for the URL's view state (context bar params, P8). */
export function networkQueryOf(state: ViewState): NetworkQuery {
  return {
    ...(state.date ? { date: state.date } : {}),
    ...(state.region ? { region: state.region } : {}),
    ...(state.format ? { format: state.format } : {}),
  }
}

export function viewStateOf(search: string): ViewState {
  return decodeViewState(search)
}

/** Heatmap bands: share of installed lanes needed. Over 100 % is over capacity. */
export type PressureBand = 'low' | 'medium' | 'high' | 'over'

export function pressureBand(pct: number, overCapacity: boolean): PressureBand {
  if (overCapacity || pct > 100) return 'over'
  if (pct >= 90) return 'high'
  if (pct >= 60) return 'medium'
  return 'low'
}

/** Token-backed cell classes per band; the value is always printed in the cell too. */
export const PRESSURE_CLASS: Readonly<Record<PressureBand, string>> = {
  low: 'bg-surface text-text',
  medium: 'bg-surface-2 text-text',
  high: 'bg-warning-soft text-on-warning-soft',
  over: 'bg-danger-soft text-on-danger-soft font-weight-semibold',
}

export const MILESTONE_TONE: Readonly<Record<MilestoneStatus, StatusTone>> = {
  done: 'success',
  overdue: 'danger',
  due_soon: 'warning',
  upcoming: 'neutral',
}

export type NetworkSort = 'store' | 'pressure' | 'cashiers'
export const NETWORK_SORTS: readonly NetworkSort[] = ['store', 'pressure', 'cashiers']

export function isNetworkSort(value: string | undefined): value is NetworkSort {
  return (NETWORK_SORTS as readonly string[]).includes(value ?? '')
}

function storePressure(s: NetworkStoreRow): number {
  return Math.max(0, ...s.departments.flatMap((d) => d.hours.map((h) => h.pressurePct)))
}

/** Store rows (each with its departments) in the chosen order; ties keep store order. */
export function sortStores(stores: readonly NetworkStoreRow[], sort: NetworkSort): NetworkStoreRow[] {
  if (sort === 'store') return [...stores]
  const key = (s: NetworkStoreRow) => (sort === 'pressure' ? storePressure(s) : s.cashiers)
  const by = (a: number, b: number) => b - a
  return [...stores]
    .map((s) => ({
      ...s,
      departments: [...s.departments].sort((a, b) =>
        sort === 'pressure'
          ? by(Math.max(0, ...a.hours.map((h) => h.pressurePct)), Math.max(0, ...b.hours.map((h) => h.pressurePct)))
          : by(a.cashiers, b.cashiers),
      ),
    }))
    .sort((a, b) => by(key(a), key(b)))
}

/** The department day plan for a department of the network view (keeps scenario + date). */
export function departmentPath(state: ViewState, storeId: string, departmentId: string, date: string): string {
  const q = encodeViewState({ ...(state.scenario ? { scenario: state.scenario } : {}), store: storeId, dept: departmentId, date })
  return `/plan/department?${q}`
}

export function rosterPath(state: ViewState): string {
  const q = encodeViewState({
    ...(state.scenario ? { scenario: state.scenario } : {}),
    ...(state.store ? { store: state.store } : {}),
    ...(state.dept ? { dept: state.dept } : {}),
  })
  return `/plan/roster${q ? `?${q}` : ''}`
}

export function summaryPath(scenarioId: string | null): string {
  return scenarioId ? `/plan/summary?${encodeViewState({ scenario: scenarioId })}` : '/plan/summary'
}

export function settingsPath(scenarioId: string): string {
  return `/scenarios/${encodeURIComponent(scenarioId)}/settings`
}

/** Clock hour → a short local label ("1 PM"), independent of the device time zone. */
export const HOUR_FORMAT: Intl.DateTimeFormatOptions = { hour: 'numeric', timeZone: 'UTC' }

export function hourDate(hour: number): Date {
  return new Date(Date.UTC(2026, 0, 1, hour))
}

/** Calendar dates from the API are plain `YYYY-MM-DD`: format them in UTC. */
export const DAY_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }
export const DATE_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeZone: 'UTC' }

/** First day of the season window plus the number of days (both inclusive). */
export function daysInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
}
