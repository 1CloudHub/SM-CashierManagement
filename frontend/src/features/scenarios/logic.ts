/**
 * Pure helpers for the scenario screens (task 11): the settings form model
 * (growth shown as a percentage, overrides as "empty = rule default"), list
 * filters ↔ URL, status tones, typed setting labels and paths.
 */
import {
  DEPARTMENT_OVERRIDE_FIELDS,
  can,
  SCENARIO_NUMERIC_RANGES,
  validateScenarioSettings,
  type DepartmentOverrideField,
  type FtShiftPattern,
  type RoleCode,
  type ScenarioDepartmentOverride,
  type ScenarioListItem,
  type ScenarioNumericOverrideKey,
  type ScenarioScalarSettingKey,
  type ScenarioSettingsIssue,
  type ScenarioSettingsValues,
  type ScenarioStatus,
  type SubmitBlocker,
} from '@lanewise/shared'
import type { StatusTone } from '@/components/ui'
import { canAccess } from '@/app/access'
import { SCREEN_BY_ID } from '@/app/screens'
import type { ScenarioListQuery } from './api'

export const SCENARIO_STATUS_TONE: Record<ScenarioStatus, StatusTone> = {
  draft: 'neutral',
  submitted: 'info',
  approved: 'success',
  published: 'success',
  superseded: 'neutral',
  archived: 'neutral',
}

export const NUMERIC_OVERRIDE_KEYS = Object.keys(SCENARIO_NUMERIC_RANGES) as ScenarioNumericOverrideKey[]

/** A department row in the form: each field a string, empty = learned value. */
export type DepartmentForm = Readonly<Record<DepartmentOverrideField, string>>

/**
 * The settings form. Growth is edited as a percentage string (1.05 ↔ "5");
 * numeric overrides as strings where "" means "use the rule default";
 * pattern / rest-day overrides as `null` = default.
 */
export interface SettingsForm {
  readonly growthPct: string
  readonly allowPartTime: boolean
  readonly planningFrom: string
  readonly planningTo: string
  readonly peakDay: string
  readonly notes: string
  readonly numeric: Readonly<Record<ScenarioNumericOverrideKey, string>>
  readonly ftShiftPattern: FtShiftPattern | null
  readonly respectPreferredRestDay: boolean | null
  /** Keyed by department id; departments without an entry use learned values. */
  readonly departments: Readonly<Record<string, DepartmentForm>>
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

const num = (v: number | null): string => (v === null ? '' : String(v))
/** "" → null (the default); anything else → a number (NaN fails validation). */
const parse = (v: string): number | null => (v.trim() === '' ? null : Number(v))

export function toForm(s: ScenarioSettingsValues): SettingsForm {
  const numeric = {} as Record<ScenarioNumericOverrideKey, string>
  for (const k of NUMERIC_OVERRIDE_KEYS) numeric[k] = num(s[k])
  const departments: Record<string, DepartmentForm> = {}
  for (const o of s.departmentOverrides) {
    departments[o.departmentId] = { baselineTxPerDay: num(o.baselineTxPerDay), handleTimeMin: num(o.handleTimeMin), upliftPct: num(o.upliftPct) }
  }
  return {
    growthPct: growthToPct(s.growth),
    allowPartTime: s.allowPartTime,
    planningFrom: s.planningFrom,
    planningTo: s.planningTo,
    peakDay: s.peakDay,
    notes: s.notes,
    numeric,
    ftShiftPattern: s.ftShiftPattern,
    respectPreferredRestDay: s.respectPreferredRestDay,
    departments,
  }
}

/** The settings the form describes (unvalidated): department rows sorted, empty rows dropped. */
export function formToCandidate(form: SettingsForm): Record<string, unknown> {
  const numeric: Record<string, number | null> = {}
  for (const k of NUMERIC_OVERRIDE_KEYS) numeric[k] = parse(form.numeric[k])
  const departmentOverrides = Object.entries(form.departments)
    .map(([departmentId, d]) => ({
      departmentId,
      baselineTxPerDay: parse(d.baselineTxPerDay),
      handleTimeMin: parse(d.handleTimeMin),
      upliftPct: parse(d.upliftPct),
    }))
    .filter((o) => DEPARTMENT_OVERRIDE_FIELDS.some((f) => o[f] !== null))
    .sort((a, b) => a.departmentId.localeCompare(b.departmentId))
  return {
    growth: pctToGrowth(form.growthPct),
    allowPartTime: form.allowPartTime,
    planningFrom: form.planningFrom,
    planningTo: form.planningTo,
    peakDay: form.peakDay,
    notes: form.notes,
    ...numeric,
    ftShiftPattern: form.ftShiftPattern,
    respectPreferredRestDay: form.respectPreferredRestDay,
    departmentOverrides,
  }
}

/** An issue id: a scalar setting key, or `dept:<departmentId>:<field>`. */
export type IssueId = ScenarioScalarSettingKey | `dept:${string}:${DepartmentOverrideField}`

export const deptIssueId = (departmentId: string, field: DepartmentOverrideField): IssueId => `dept:${departmentId}:${field}`

function issueIdOf(issue: ScenarioSettingsIssue, overrides: readonly ScenarioDepartmentOverride[]): IssueId | null {
  if (issue.path !== 'departmentOverrides') return issue.path
  const id = issue.departmentId ?? (issue.index !== undefined ? overrides[issue.index]?.departmentId : undefined)
  const field = issue.field && issue.field !== 'departmentId' ? issue.field : null
  return id && field ? deptIssueId(id, field) : null
}

export type FormValidation =
  | { readonly ok: true; readonly settings: ScenarioSettingsValues }
  | { readonly ok: false; readonly issues: ReadonlySet<IssueId> }

/** Client-side check with the shared validator (the API re-validates). */
export function validateForm(form: SettingsForm): FormValidation {
  const candidate = formToCandidate(form)
  const result = validateScenarioSettings(candidate)
  if (result.ok) return result
  const overrides = candidate.departmentOverrides as ScenarioDepartmentOverride[]
  const ids = result.issues.map((i) => issueIdOf(i, overrides)).filter((i): i is IssueId => i !== null)
  return { ok: false, issues: new Set(ids) }
}

/**
 * Server `validation_failed` details → issue ids. Department rows are
 * reported by index (`body.settings.departmentOverrides.<i>.<field>`), so the
 * submitted settings resolve the index to a department.
 */
export function issuesFromDetails(details: readonly { path?: string }[], submitted?: ScenarioSettingsValues): Set<IssueId> {
  const ids = new Set<IssueId>()
  for (const d of details) {
    const dept = /^body\.settings\.departmentOverrides\.(\d+)\.(\w+)/.exec(d.path ?? '')
    if (dept) {
      const id = submitted?.departmentOverrides[Number(dept[1])]?.departmentId
      const field = dept[2] as DepartmentOverrideField
      if (id && (DEPARTMENT_OVERRIDE_FIELDS as readonly string[]).includes(field)) ids.add(deptIssueId(id, field))
      continue
    }
    const m = /^body\.settings\.(\w+)/.exec(d.path ?? '')
    if (m && m[1] !== 'departmentOverrides') ids.add(m[1] as ScenarioScalarSettingKey)
  }
  return ids
}

/** Whether two forms describe the same settings (empty department rows ignored). */
export function formEquals(a: SettingsForm, b: SettingsForm): boolean {
  return JSON.stringify(formToCandidate(a)) === JSON.stringify(formToCandidate(b))
}

/** The issue ids an edit of `key` can affect (cross-field rules included). */
export function relatedIssueIds(key: IssueId): readonly IssueId[] {
  if (key === 'planningFrom' || key === 'planningTo' || key === 'peakDay') return ['planningFrom', 'planningTo', 'peakDay']
  if (key === 'ftMaxHoursPerWeek' || key === 'ptMaxHoursPerWeek') return ['ftMaxHoursPerWeek', 'ptMaxHoursPerWeek']
  return [key]
}

/**
 * Blur validation: re-check the fields related to `key` and update just their
 * issues, leaving the others as they were.
 */
export function issuesAfterBlur(form: SettingsForm, current: ReadonlySet<IssueId>, key: IssueId): ReadonlySet<IssueId> {
  const v = validateForm(form)
  const next = new Set(current)
  for (const id of relatedIssueIds(key)) {
    next.delete(id)
    if (!v.ok && v.issues.has(id)) next.add(id)
  }
  return next
}

/** Why Submit is unavailable: the API's blocker, or unsaved edits in the form. */
export type SettingsBlocker = SubmitBlocker | 'unsaved'

export function settingsBlocker(submitBlocker: SubmitBlocker | null, dirty: boolean): SettingsBlocker | null {
  return dirty ? 'unsaved' : submitBlocker
}

/** The blocker for a list row (the list item carries no `submitBlocker`). */
export function listRowBlocker(s: Pick<ScenarioListItem, 'status' | 'stale' | 'lastRunAt'>): SubmitBlocker | null {
  if (s.status !== 'draft') return 'not_draft'
  if (s.stale) return 'stale'
  if (s.lastRunAt === null) return 'not_run'
  return null
}

/** API error codes for a refused submit → the blocker they mean (else null). */
export function blockerFromError(code: string | null, message: string | undefined): SubmitBlocker | null {
  if (code !== 'conflict' || !message) return null
  if (/stale/i.test(message)) return 'stale'
  if (/\brun\b/i.test(message)) return 'not_run'
  return null
}

// ---------------------------------------------------------------------------
// Typed labels for settings (compare + settings screen)
// ---------------------------------------------------------------------------

/** The i18n key of each setting's label — total over every scalar setting. */
export const SETTING_LABEL_KEY = {
  growth: 'scenarios.settings.growth',
  allowPartTime: 'scenarios.settings.allowPartTime',
  planningFrom: 'scenarios.settings.planningFrom',
  planningTo: 'scenarios.settings.planningTo',
  peakDay: 'scenarios.settings.peakDay',
  notes: 'scenarios.settings.notes',
  servedWithinPct: 'scenarios.settings.servedWithinPct',
  waitSeconds: 'scenarios.settings.waitSeconds',
  shrinkage: 'scenarios.settings.shrinkage',
  minOpenLanes: 'scenarios.settings.minOpenLanes',
  ftShiftPattern: 'scenarios.settings.ftShiftPattern',
  ptShiftHours: 'scenarios.settings.ptShiftHours',
  maxPtSharePct: 'scenarios.settings.maxPtSharePct',
  mealEarliestAfterHours: 'scenarios.settings.mealEarliestAfterHours',
  absenceReservePct: 'scenarios.settings.absenceReservePct',
  ftMaxDaysPerWeek: 'scenarios.settings.ftMaxDaysPerWeek',
  ftMaxHoursPerWeek: 'scenarios.settings.ftMaxHoursPerWeek',
  ptMaxDaysPerWeek: 'scenarios.settings.ptMaxDaysPerWeek',
  ptMaxHoursPerWeek: 'scenarios.settings.ptMaxHoursPerWeek',
  minRestHours: 'scenarios.settings.minRestHours',
  maxConsecutiveDays: 'scenarios.settings.maxConsecutiveDays',
  respectPreferredRestDay: 'scenarios.settings.respectPreferredRestDay',
} as const satisfies Record<ScenarioScalarSettingKey, `scenarios.settings.${string}`>

/** The i18n key of a setting's validation message. */
export function settingIssueKey<K extends ScenarioScalarSettingKey>(key: K): `scenarios.settings.issue.${K}` {
  return `scenarios.settings.issue.${key}`
}

export const DEPARTMENT_FIELD_LABEL_KEY = {
  baselineTxPerDay: 'scenarios.settings.dept.baselineTxPerDay',
  handleTimeMin: 'scenarios.settings.dept.handleTimeMin',
  upliftPct: 'scenarios.settings.dept.upliftPct',
} as const satisfies Record<DepartmentOverrideField, string>

export const FT_PATTERN_LABEL_KEY = {
  '8+1': 'scenarios.settings.ftShiftPattern.8+1',
  '7+1': 'scenarios.settings.ftShiftPattern.7+1',
} as const satisfies Record<FtShiftPattern, string>

// ---------------------------------------------------------------------------
// SCR-030 filters and links
// ---------------------------------------------------------------------------

export type ListFilters = Required<ScenarioListQuery>

/** SCR-030 filters ↔ `location.search`. */
export function filtersFromSearch(search: string): ListFilters {
  const p = new URLSearchParams(search)
  return {
    status: (p.get('status') ?? '') as ScenarioStatus | '',
    season: p.get('season') ?? '',
    stale: p.get('stale') === 'true',
    q: p.get('q') ?? '',
    owner: p.get('owner') === 'me' ? 'me' : '',
  }
}

export function filtersToSearch(f: ScenarioListQuery): string {
  const p = new URLSearchParams()
  if (f.q) p.set('q', f.q)
  if (f.status) p.set('status', f.status)
  if (f.season) p.set('season', f.season)
  if (f.owner) p.set('owner', f.owner)
  if (f.stale) p.set('stale', 'true')
  const s = p.toString()
  return s ? `?${s}` : ''
}

export function hasActiveFilters(f: ListFilters): boolean {
  return f.q.trim() !== '' || f.status !== '' || f.season !== '' || f.owner !== '' || f.stale
}

export const NO_FILTERS: ListFilters = { status: '', season: '', stale: false, q: '', owner: '' }

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

/**
 * Where a scenario's name links for `role`: planners open the settings; other
 * roles open the published plan's hiring view when they can see it (the
 * wireframe's ★ link), otherwise the read-only settings — never a screen the
 * role can't open.
 */
export function scenarioHref(role: RoleCode | null, s: Pick<ScenarioListItem, 'id' | 'isPublished'>): string | null {
  if (!role) return null
  if (can(role, 'scenario_settings', 'edit')) return settingsPath(s.id)
  if (s.isPublished && canAccess(role, 'SCR-023')) return SCREEN_BY_ID['SCR-023'].path
  return canAccess(role, 'SCR-031') ? settingsPath(s.id) : null
}

/** Scenario dates are calendar dates (YYYY-MM-DD); format without a time-zone shift. */
export const CALENDAR_DATE: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeZone: 'UTC' }
export const DATE_TIME: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }
/** Date-only for instants ("Data as of"): the Manila calendar day. */
export const DATE_ONLY: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeZone: 'Asia/Manila' }

/** Signed number options for deltas (+5, −3, 0). */
export const SIGNED: Intl.NumberFormatOptions = { signDisplay: 'exceptZero', maximumFractionDigits: 1 }
