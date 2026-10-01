import {
  HTTP_STATUS_BY_ERROR_CODE,
  can,
  canPublishRuleVersion,
  diffRulePayloads,
  isIsoDate,
  isRuleVersionEditable,
  validateRulePayload,
  type ApiErrorCode,
  type ApiErrorDetail,
  type RoleCode,
  type RuleSetSummary,
  type RuleSetType,
  type RuleVersionDetail,
  type RuleVersionDiff,
  type RuleVersionStatus,
  type RuleVersionSummary,
} from '@lanewise/shared'
import type { ApiResponse } from './client'
import { PEOPLE, WORLD_SCENARIOS, demoNow } from './mock-world'

/**
 * In-memory `/rule-sets` and `/rule-versions` for the mock API (task 10,
 * SCR-060/061), with the API's guards: everyone with "Business rules" views,
 * the Rules Steward edits and publishes non-cost rules, Finance approves and
 * publishes cost rules (`approve-and-publish`). Every version is kept; the
 * wage rate draft is waiting for Finance (wireframe SCR-060), and the
 * transport allowance draft came back with Finance's request for changes.
 * Sample data — simulated, not SM actuals.
 */

type Mutable<T> = { -readonly [K in keyof T]: T[K] }
type Version = Mutable<RuleVersionDetail>

interface MockRuleSet {
  readonly id: string
  readonly type: RuleSetType
  readonly name: string
  readonly isCostRule: boolean
}

const RULE_SETS: readonly MockRuleSet[] = [
  { id: 'rules-holidays', type: 'holidays', name: 'Holiday calendar 2026', isCostRule: false },
  { id: 'rules-wages', type: 'wages', name: 'Wage rates (by region)', isCostRule: true },
  { id: 'rules-premiums', type: 'premiums', name: 'Premium pay multipliers', isCostRule: true },
  { id: 'rules-lead-times', type: 'lead_times', name: 'Planning lead times', isCostRule: false },
  { id: 'rules-labor', type: 'labor', name: 'Labor rules (PH)', isCostRule: false },
  { id: 'rules-service', type: 'service_levels', name: 'Service targets', isCostRule: false },
  { id: 'rules-transport', type: 'transport_allowance', name: 'Transport allowance', isCostRule: true },
]

const HOLIDAYS_2025 = [
  { date: '2025-12-08', name: 'Feast of the Immaculate Conception', dayType: 'special' },
  { date: '2025-12-24', name: 'Christmas Eve', dayType: 'special' },
  { date: '2025-12-25', name: 'Christmas Day', dayType: 'regularHoliday' },
  { date: '2025-12-30', name: 'Rizal Day', dayType: 'regularHoliday' },
  { date: '2025-12-31', name: 'Last day of the year', dayType: 'special' },
] as const

const HOLIDAYS_2026 = [
  { date: '2026-11-01', name: 'All Saints’ Day', dayType: 'special' },
  { date: '2026-11-30', name: 'Bonifacio Day', dayType: 'regularHoliday' },
  { date: '2026-12-08', name: 'Feast of the Immaculate Conception', dayType: 'special' },
  { date: '2026-12-24', name: 'Christmas Eve', dayType: 'special' },
  { date: '2026-12-25', name: 'Christmas Day', dayType: 'regularHoliday' },
  { date: '2026-12-30', name: 'Rizal Day', dayType: 'regularHoliday' },
  { date: '2026-12-31', name: 'Last day of the year', dayType: 'special' },
] as const

const WAGES_V1 = { hourlyRateByRegion: { NCR: 82.5, 'Central Luzon': 66.25, 'Central Visayas': 64.375 }, defaultHourlyRate: 78, employerLoading: 0.14 }
const WAGES_V2 = { hourlyRateByRegion: { NCR: 86.875, 'Central Luzon': 68.75, 'Central Visayas': 67.5 }, defaultHourlyRate: 80, employerLoading: 0.14 }
const WAGES_V3 = { hourlyRateByRegion: { NCR: 87.5, 'Central Luzon': 69.375, 'Central Visayas': 67.5 }, defaultHourlyRate: 80, employerLoading: 0.14 }

const PREMIUMS = { dayTypeMultiplier: { regular: 1, special: 1.3, regularHoliday: 2 }, nightDifferential: 0.1, nightStartHour: 22, nightEndHour: 6, overtimeMultiplier: 1.25, regularHoursPerShift: 8 }

const LEAD_TIMES = {
  leadTimeDays: { FT: 42, PT: 28, FLOAT: 21 },
  contractWeeklyHours: { FT: 48, PT: 24, FLOAT: 32 },
  recruitingBuffer: 0.1,
  milestones: [
    { name: 'Requisition approved', daysBeforeNeedBy: { FT: 42, PT: 28, FLOAT: 21 } },
    { name: 'Job posted', daysBeforeNeedBy: { FT: 38, PT: 25, FLOAT: 19 } },
    { name: 'Interviews complete', daysBeforeNeedBy: { FT: 28, PT: 18, FLOAT: 14 } },
    { name: 'Offers accepted', daysBeforeNeedBy: { FT: 21, PT: 14, FLOAT: 10 } },
    { name: 'Onboarding and POS training', daysBeforeNeedBy: { FT: 7, PT: 5, FLOAT: 5 } },
    { name: 'Start on the floor', daysBeforeNeedBy: { FT: 0, PT: 0, FLOAT: 0 } },
  ],
}

const LABOR = { maxConsecutiveDays: 6, restAfterConsecutiveDays: 6, mandatoryRestHours: 24, minRestBetweenShiftsHours: 10, maxWeeklyHours: { FT: 48, PT: 30, FLOAT: 40 } }

const SERVICE = {
  serviceTarget: { serviceLevel: 0.9, thresholdSec: 60 },
  shrinkage: 0.17,
  shifts: {
    ftSpanHours: 9,
    ftMealHours: 1,
    mealWindow: { earliestOffset: 4, latestOffset: 6 },
    ftMinUsefulHours: 9,
    reliefMinUsefulHours: 2,
    ptMinHours: 4,
    ptMaxHours: 4,
    ptMinUsefulHours: 1,
    floatMinHours: 8,
    floatMaxHours: 8,
    floatMinUsefulHours: 7,
  },
}

const TRANSPORT_V1 = { bands: [{ upToMinutes: 15, amount: 0 }, { upToMinutes: 30, amount: 80 }, { upToMinutes: 45, amount: 120 }, { upToMinutes: 90, amount: 160 }] }
const TRANSPORT_V2 = { bands: [{ upToMinutes: 15, amount: 40 }, { upToMinutes: 30, amount: 100 }, { upToMinutes: 45, amount: 140 }, { upToMinutes: 90, amount: 180 }] }

const STEWARD = PEOPLE.steward
const FORMER_STEWARD = PEOPLE.formerSteward
const FINANCE = PEOPLE.finance

interface Seed {
  readonly ruleSetId: string
  readonly version: number
  readonly status: RuleVersionStatus
  readonly effectiveFrom: string
  readonly payload: Readonly<Record<string, unknown>>
  readonly changeNote: string
  readonly by: { readonly id: string; readonly name: string }
  /** Last change (submitted / published) time. */
  readonly at: string
  readonly reviewComment?: string
}

const SEEDS: readonly Seed[] = [
  { ruleSetId: 'rules-holidays', version: 1, status: 'superseded', effectiveFrom: '2025-01-01', payload: { holidays: HOLIDAYS_2025 }, changeNote: '2025 proclamation.', by: FORMER_STEWARD, at: '2024-12-02T10:00:00+08:00' },
  { ruleSetId: 'rules-holidays', version: 2, status: 'published', effectiveFrom: '2026-01-01', payload: { holidays: HOLIDAYS_2026 }, changeNote: 'Proclamation for 2026 holidays.', by: FORMER_STEWARD, at: '2025-11-20T10:00:00+08:00' },
  { ruleSetId: 'rules-wages', version: 1, status: 'superseded', effectiveFrom: '2025-01-01', payload: WAGES_V1, changeNote: 'Wage order NCR-25.', by: FORMER_STEWARD, at: '2024-12-15T10:00:00+08:00' },
  { ruleSetId: 'rules-wages', version: 2, status: 'published', effectiveFrom: '2026-07-01', payload: WAGES_V2, changeNote: 'Wage order NCR-26: NCR hourly base ₱82.50 → ₱86.88.', by: STEWARD, at: '2026-06-20T10:00:00+08:00' },
  { ruleSetId: 'rules-wages', version: 3, status: 'submitted', effectiveFrom: '2026-11-01', payload: WAGES_V3, changeNote: 'Regional board increase from November 1.', by: STEWARD, at: '2026-09-29T15:20:00+08:00' },
  { ruleSetId: 'rules-premiums', version: 1, status: 'published', effectiveFrom: '2025-01-01', payload: PREMIUMS, changeNote: 'Labor Code premiums and night differential.', by: FORMER_STEWARD, at: '2024-12-15T10:00:00+08:00' },
  { ruleSetId: 'rules-lead-times', version: 1, status: 'published', effectiveFrom: '2025-01-01', payload: LEAD_TIMES, changeNote: 'Recruiting lead times agreed with HR.', by: FORMER_STEWARD, at: '2024-12-15T10:00:00+08:00' },
  { ruleSetId: 'rules-labor', version: 1, status: 'published', effectiveFrom: '2025-01-01', payload: LABOR, changeNote: 'Rest days, rest between shifts and weekly hours.', by: FORMER_STEWARD, at: '2024-12-15T10:00:00+08:00' },
  { ruleSetId: 'rules-service', version: 1, status: 'published', effectiveFrom: '2026-01-01', payload: SERVICE, changeNote: '90% served within 60 s.', by: FORMER_STEWARD, at: '2025-12-15T10:00:00+08:00' },
  { ruleSetId: 'rules-transport', version: 1, status: 'published', effectiveFrom: '2026-06-01', payload: TRANSPORT_V1, changeNote: 'Allowance bands for cross-store shifts.', by: STEWARD, at: '2026-05-20T10:00:00+08:00' },
  {
    ruleSetId: 'rules-transport',
    version: 2,
    status: 'changes_requested',
    effectiveFrom: '2026-11-01',
    payload: TRANSPORT_V2,
    changeNote: 'Raise every band by ₱20; pay ₱40 under 15 min.',
    by: STEWARD,
    at: '2026-09-24T09:00:00+08:00',
    reviewComment: 'Keep the first band at ₱0 — short trips are within the store’s area.',
  },
]

/** Scenarios still in play (not archived or superseded) pin every rule set. */
const ACTIVE_SCENARIO_IDS = WORLD_SCENARIOS.filter((s) => s.status !== 'archived' && s.status !== 'superseded').map((s) => s.id)

function seedVersion(seed: Seed): Version {
  const set = RULE_SETS.find((r) => r.id === seed.ruleSetId) as MockRuleSet
  const submitted = seed.status !== 'draft'
  const published = seed.status === 'published' || seed.status === 'superseded'
  return {
    id: `rv-${seed.ruleSetId.replace(/^rules-/, '')}-${seed.version}`,
    ruleSetId: set.id,
    version: seed.version,
    effectiveFrom: seed.effectiveFrom,
    status: seed.status,
    isCostRule: set.isCostRule,
    updatedAt: seed.at,
    ruleSetType: set.type,
    ruleSetName: set.name,
    payload: seed.payload,
    changeNote: seed.changeNote,
    createdBy: seed.by.id,
    createdByName: seed.by.name,
    submittedAt: submitted ? seed.at : null,
    submittedBy: submitted ? seed.by.id : null,
    submittedByName: submitted ? seed.by.name : null,
    financeApprovedBy: published && set.isCostRule ? FINANCE.id : null,
    financeApprovedByName: published && set.isCostRule ? FINANCE.name : null,
    financeApprovedAt: published && set.isCostRule ? seed.at : null,
    reviewComment: seed.reviewComment ?? null,
    publishedBy: published ? (set.isCostRule ? FINANCE.id : seed.by.id) : null,
    publishedByName: published ? (set.isCostRule ? FINANCE.name : seed.by.name) : null,
    publishedAt: published ? seed.at : null,
    synthetic: true,
  }
}

const ACTOR: Readonly<Partial<Record<RoleCode, { id: string; name: string }>>> = { RST: STEWARD, FIN: FINANCE }

let seq = 0
function fail(code: ApiErrorCode, message: string, details?: ApiErrorDetail[]): ApiResponse {
  seq += 1
  return { status: HTTP_STATUS_BY_ERROR_CODE[code], body: { error: { code, message, requestId: `mock-rule-${seq}`, ...(details ? { details } : {}) } } }
}
const ok = (body: unknown, status = 200): ApiResponse => ({ status, body })
const notFound = () => fail('not_found', 'We couldn’t find that.')
const forbidden = () => fail('forbidden', 'You do not have access to this resource.')
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export interface MockRulesStore {
  /** Whether this store answers `pathname`. */
  owns(pathname: string): boolean
  handle(input: { method: string; pathname: string; body: unknown; role: RoleCode }): ApiResponse
}

export function createRulesStore(now: () => string = () => demoNow().toISOString()): MockRulesStore {
  const versions: Version[] = SEEDS.map(seedVersion)

  const summaryOf = (v: Version): RuleVersionSummary => ({
    id: v.id,
    ruleSetId: v.ruleSetId,
    version: v.version,
    effectiveFrom: v.effectiveFrom,
    status: v.status,
    isCostRule: v.isCostRule,
    updatedAt: v.updatedAt,
  })
  const ofSet = (id: string) => versions.filter((v) => v.ruleSetId === id).sort((a, b) => b.version - a.version)
  const setSummary = (set: MockRuleSet): RuleSetSummary => {
    const list = ofSet(set.id)
    const current = list.find((v) => v.status === 'published')
    const open = list.find((v) => v.status !== 'published' && v.status !== 'superseded')
    return { ...set, currentVersion: current ? summaryOf(current) : null, openVersion: open ? summaryOf(open) : null, scenarioCount: ACTIVE_SCENARIO_IDS.length }
  }
  const actor = (role: RoleCode) => ACTOR[role] ?? { id: `u-${role.toLowerCase()}`, name: `Demo ${role}` }
  const previous = (v: Version) => ofSet(v.ruleSetId).find((x) => x.version < v.version) ?? null
  const payloadIssues = (type: RuleSetType, payload: unknown, prefix: string): ApiErrorDetail[] => {
    const r = validateRulePayload(type, payload)
    return r.ok ? [] : r.issues.map((i) => ({ path: i.path ? `${prefix}.${i.path}` : prefix, message: i.message }))
  }
  const needsNote = (v: Version) =>
    v.changeNote.trim().length === 0 ? fail('validation_failed', 'Add a change note first.', [{ path: 'changeNote', message: 'A change note is required.' }]) : null

  function publish(v: Version, role: RoleCode, approve: boolean): ApiResponse {
    const at = now()
    const who = actor(role)
    const current = ofSet(v.ruleSetId).find((x) => x.status === 'published')
    if (current) current.status = 'superseded'
    if (approve) {
      v.financeApprovedBy = who.id
      v.financeApprovedByName = who.name
      v.financeApprovedAt = at
    }
    v.status = 'published'
    v.publishedBy = who.id
    v.publishedByName = who.name
    v.publishedAt = at
    v.updatedAt = at
    return ok({ version: { ...v }, supersededVersionId: current?.id ?? null, staleScenarioIds: [...ACTIVE_SCENARIO_IDS] })
  }

  return {
    owns: (pathname) => /^\/(rule-sets|rule-versions)(\/|$)/.test(pathname),
    handle({ method, pathname, body, role }) {
      const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent)
      if (!can(role, 'rules', 'view')) return forbidden()

      if (parts[0] === 'rule-sets') {
        if (parts.length === 1 && method === 'GET') return ok({ ruleSets: RULE_SETS.map(setSummary) })
        const set = RULE_SETS.find((r) => r.id === parts[1])
        if (!set || parts[2] !== 'versions' || parts.length !== 3) return notFound()
        if (method === 'GET') return ok({ ruleSet: set, versions: ofSet(set.id).map(summaryOf) })
        if (method !== 'POST') return notFound()
        if (!can(role, 'rules', 'edit')) return forbidden()
        const b = isRecord(body) ? body : {}
        if (!isIsoDate(b.effectiveFrom)) return fail('validation_failed', 'Some fields are missing or invalid.', [{ path: 'body.effectiveFrom', message: 'Must be a date (YYYY-MM-DD).' }])
        const list = ofSet(set.id)
        if (list.some((v) => v.status !== 'published' && v.status !== 'superseded')) return fail('conflict', 'This rule set already has an open draft version.')
        const base = list.find((v) => v.status === 'published') ?? list[0]
        const payload = isRecord(b.payload) ? b.payload : base?.payload
        if (!payload) return fail('validation_failed', 'This rule set has no version yet; provide the rule values.', [{ path: 'body.payload', message: 'Required.' }])
        const issues = payloadIssues(set.type, payload, 'body.payload')
        if (issues.length > 0) return fail('validation_failed', 'Some rule values are missing or invalid.', issues)
        const who = actor(role)
        const at = now()
        const created: Version = {
          ...seedVersion({ ruleSetId: set.id, version: (list[0]?.version ?? 0) + 1, status: 'draft', effectiveFrom: b.effectiveFrom, payload, changeNote: typeof b.changeNote === 'string' ? b.changeNote : '', by: who, at }),
        }
        versions.push(created)
        return ok({ version: { ...created } }, 201)
      }

      // /rule-versions/:id[/action]
      const v = versions.find((x) => x.id === parts[1])
      if (!v || parts.length > 3) return notFound()
      const action = parts[2]
      if (action === undefined && method === 'GET') {
        const impacted = v.status === 'published' || v.status === 'superseded' ? [] : ACTIVE_SCENARIO_IDS
        return ok({ version: { ...v }, impact: { scenarioIds: [...impacted] } })
      }
      if (action === 'diff' && method === 'GET') {
        const base = previous(v)
        const diff: RuleVersionDiff = { fromVersionId: base?.id ?? null, toVersionId: v.id, changes: diffRulePayloads(base?.payload ?? {}, v.payload) }
        return ok(diff)
      }
      if (action === undefined && method === 'PATCH') {
        if (!can(role, 'rules', 'edit')) return forbidden()
        if (!isRuleVersionEditable(v.status)) return fail('conflict', `A ${v.status} version can no longer be edited.`)
        const b = isRecord(body) ? body : {}
        if (b.effectiveFrom !== undefined && !isIsoDate(b.effectiveFrom)) return fail('validation_failed', 'Some fields are missing or invalid.', [{ path: 'body.effectiveFrom', message: 'Must be a date (YYYY-MM-DD).' }])
        if (b.payload !== undefined) {
          const issues = payloadIssues(v.ruleSetType, b.payload, 'body.payload')
          if (issues.length > 0) return fail('validation_failed', 'Some rule values are missing or invalid.', issues)
          if (isRecord(b.payload)) v.payload = b.payload
        }
        if (isIsoDate(b.effectiveFrom)) v.effectiveFrom = b.effectiveFrom
        if (typeof b.changeNote === 'string') v.changeNote = b.changeNote
        v.status = 'draft'
        v.updatedAt = now()
        return ok({ version: { ...v } })
      }
      if (method !== 'POST') return notFound()
      const comment = isRecord(body) && typeof body.comment === 'string' ? body.comment.trim() : ''
      switch (action) {
        case 'submit': {
          if (!can(role, 'rules', 'edit')) return forbidden()
          const missing = needsNote(v)
          if (missing) return missing
          if (!isRuleVersionEditable(v.status)) return fail('conflict', `A ${v.status} version cannot be submitted.`)
          const who = actor(role)
          v.status = 'submitted'
          v.submittedAt = now()
          v.submittedBy = who.id
          v.submittedByName = who.name
          v.updatedAt = v.submittedAt
          return ok({ version: { ...v } })
        }
        case 'approve':
        case 'request-changes': {
          if (!can(role, 'rules_cost_approval', 'approve')) return forbidden()
          if (!v.isCostRule || v.status !== 'submitted') return fail('conflict', `A ${v.status} version cannot be reviewed.`)
          if (action === 'request-changes') {
            if (!comment) return fail('validation_failed', 'Some fields are missing or invalid.', [{ path: 'body.comment', message: 'A comment is required.' }])
            v.status = 'changes_requested'
            v.reviewComment = comment
          } else {
            const missing = needsNote(v)
            if (missing) return missing
            const who = actor(role)
            v.status = 'approved'
            v.financeApprovedBy = who.id
            v.financeApprovedByName = who.name
            v.financeApprovedAt = now()
          }
          v.updatedAt = now()
          return ok({ version: { ...v } })
        }
        case 'publish': {
          if (!can(role, v.isCostRule ? 'rules_cost_approval' : 'rules_noncost_publish', 'approve')) return forbidden()
          const missing = needsNote(v)
          if (missing) return missing
          if (!canPublishRuleVersion(role, v.isCostRule, v.status)) {
            return fail('conflict', v.isCostRule && v.status !== 'approved' ? 'A cost rule needs Finance approval before it can be published.' : `A ${v.status} version cannot be published.`)
          }
          return publish(v, role, false)
        }
        case 'approve-and-publish': {
          if (!can(role, 'rules_cost_approval', 'approve')) return forbidden()
          const missing = needsNote(v)
          if (missing) return missing
          if (!v.isCostRule || v.status !== 'submitted') return fail('conflict', `A ${v.status} version cannot be approved and published.`)
          return publish(v, role, true)
        }
        default:
          return notFound()
      }
    },
  }
}
