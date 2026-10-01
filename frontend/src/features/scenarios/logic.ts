/**
 * Pure helpers for the scenario screens (task 11): the settings form model
 * (growth shown as a percentage), list filters ↔ URL, status tones and paths.
 */
import {
  validateScenarioSettings,
  type ScenarioListItem,
  type ScenarioSettingKey,
  type ScenarioSettingsValues,
  type ScenarioStatus,
} from '@lanewise/shared'
import type { StatusTone } from '@/components/ui'
import type { ScenarioListQuery } from './api'

export const SCENARIO_STATUS_TONE: Record<ScenarioStatus, StatusTone> = {
  draft: 'neutral',
  submitted: 'info',
  approved: 'success',
  published: 'success',
  superseded: 'neutral',
  archived: 'neutral',
}

/** The settings form: growth is edited as a percentage string (1.05 ↔ "5"). */
export interface SettingsForm {
  readonly growthPct: string
  readonly allowPartTime: boolean
  readonly planningFrom: string
  readonly planningTo: string
  readonly peakDay: string
  readonly notes: string
}

/** 1.05 → "5", 0.9 → "-10" (rounded to 2 decimals, no float noise). */
export function growthToPct(growth: number): string {
  return String(Math.round((growth - 1) * 10_000) / 100)
}

/** "5" → 1.05; empty or non-numeric → NaN (the validator rejects it). */
export function pctToGrowth(pct: string): number {
  if (pct.trim() === '') return Number.NaN
  return Math.round((1 + Number(pct) / 100) * 10_000) / 10_000
}

export function toForm(s: ScenarioSettingsValues): SettingsForm {
  return {
    growthPct: growthToPct(s.growth),
    allowPartTime: s.allowPartTime,
    planningFrom: s.planningFrom,
    planningTo: s.planningTo,
    peakDay: s.peakDay,
    notes: s.notes,
  }
}

export type FormValidation =
  | { readonly ok: true; readonly settings: ScenarioSettingsValues }
  | { readonly ok: false; readonly issues: ReadonlySet<ScenarioSettingKey> }

/** Client-side check with the shared validator (the API re-validates). */
export function validateForm(form: SettingsForm): FormValidation {
  const result = validateScenarioSettings({
    growth: pctToGrowth(form.growthPct),
    allowPartTime: form.allowPartTime,
    planningFrom: form.planningFrom,
    planningTo: form.planningTo,
    peakDay: form.peakDay,
    notes: form.notes,
  })
  return result.ok ? result : { ok: false, issues: new Set(result.issues.map((i) => i.path)) }
}

/** Server `validation_failed` details (`body.settings.<key>`) → setting keys. */
export function issuesFromDetails(details: readonly { path?: string }[]): Set<ScenarioSettingKey> {
  const keys = new Set<ScenarioSettingKey>()
  for (const d of details) {
    const m = /^body\.settings\.(\w+)/.exec(d.path ?? '')
    if (m) keys.add(m[1] as ScenarioSettingKey)
  }
  return keys
}

export function formEquals(a: SettingsForm, b: SettingsForm): boolean {
  return (Object.keys(a) as (keyof SettingsForm)[]).every((k) => a[k] === b[k])
}

/** SCR-030 filters ↔ `location.search`. */
export function filtersFromSearch(search: string): Required<ScenarioListQuery> {
  const p = new URLSearchParams(search)
  return {
    status: (p.get('status') ?? '') as ScenarioStatus | '',
    season: p.get('season') ?? '',
    stale: p.get('stale') === 'true',
    q: p.get('q') ?? '',
  }
}

export function filtersToSearch(f: ScenarioListQuery): string {
  const p = new URLSearchParams()
  if (f.q) p.set('q', f.q)
  if (f.status) p.set('status', f.status)
  if (f.season) p.set('season', f.season)
  if (f.stale) p.set('stale', 'true')
  const s = p.toString()
  return s ? `?${s}` : ''
}

/** Distinct seasons, sorted, for the season filter. */
export function seasonsOf(items: readonly ScenarioListItem[]): string[] {
  return [...new Set(items.map((s) => s.season))].sort()
}

export const settingsPath = (id: string): string => `/scenarios/${encodeURIComponent(id)}/settings`

export function comparePath(a?: string | null, b?: string | null): string {
  const p = new URLSearchParams()
  if (a) p.set('a', a)
  if (b) p.set('b', b)
  const s = p.toString()
  return `/scenarios/compare${s ? `?${s}` : ''}`
}

/** Scenario dates are calendar dates (YYYY-MM-DD); format without a time-zone shift. */
export const CALENDAR_DATE: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeZone: 'UTC' }
export const DATE_TIME: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }

/** Signed number options for deltas (+5, −3, 0). */
export const SIGNED: Intl.NumberFormatOptions = { signDisplay: 'exceptZero', maximumFractionDigits: 1 }
