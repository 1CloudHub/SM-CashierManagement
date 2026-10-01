import {
  ADMIN_USER_STATUS_FILTERS,
  AUDIT_EVENT_CATEGORIES,
  DOMAIN_NOT_ALLOWED_MESSAGE,
  HTTP_STATUS_BY_ERROR_CODE,
  auditCategoriesFor,
  auditChanges,
  auditEventCategory,
  buildCsvExport,
  can,
  checkInviteEmail,
  isRoleCode,
  sortRoles,
  type AdminScopeInput,
  type AdminScopeView,
  type AdminUser,
  type AdminUserListResponse,
  type ApiErrorCode,
  type ApiErrorDetail,
  type AuditAction,
  type AuditLogEntry,
  type AuditLogResponse,
  type AuditSnapshot,
  type FileDownload,
  type RoleCode,
  type ScopeOptions,
} from '@lanewise/shared'
import type { ApiResponse } from './client'
import { PEOPLE, STORE_MANAGERS, WORLD_REGIONS, WORLD_STAFF, WORLD_STORES, demoNow } from './mock-world'

/**
 * In-memory `/admin/*` and `/audit-events` for the mock API (SCR-070..073).
 *
 * Mirrors the API: `users_roles` guards the user routes (System Admin),
 * `audit_log` the log (System Admin; Rules Steward limited to data and rules
 * events, applied here like on the server), only allowlisted work emails are
 * invited (P13), and every change appends exactly one audit event (P7) —
 * including the CSV export. Names and figures are the wireframe samples.
 */

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

const REGIONS: readonly { id: string; name: string }[] = WORLD_REGIONS.map(({ id, name }) => ({ id, name }))

const STORES: readonly { id: string; name: string; regionId: string }[] = WORLD_STORES.map(({ id, name, regionId }) => ({ id, name, regionId }))

const SCOPE_OPTIONS: ScopeOptions = { regions: [...REGIONS], stores: [...STORES] }

/** Work email of a cashier (first name + surname): how a Staff role links to a staff record (Q16). */
export function staffEmail(name: string): string {
  const [first = '', ...rest] = name.toLowerCase().normalize('NFD').replace(/[^a-z ]/g, '').split(' ')
  return `${first}.${rest.join('')}@smretail.com`
}

/** Staff records a Staff role links to by work email (Q16). */
const STAFF_BY_EMAIL: Readonly<Record<string, { id: string; name: string }>> = Object.fromEntries(
  WORLD_STAFF.map((w) => [staffEmail(w.name), { id: w.id, name: w.name }]),
)

const ADMIN = { id: PEOPLE.admin.id, name: PEOPLE.admin.name }

interface MockAuditRow {
  readonly id: string
  readonly at: string
  readonly user: { id: string; name: string }
  readonly activeRole: RoleCode
  readonly action: AuditAction
  readonly event: string
  readonly objectType: string
  readonly objectId: string
  readonly objectName: string | null
  readonly before: AuditSnapshot
  readonly after: AuditSnapshot
}

function scopeView(input: AdminScopeInput): AdminScopeView {
  switch (input.type) {
    case 'global':
      return { type: 'global' }
    case 'region':
      return { type: 'region', regions: REGIONS.filter((r) => input.regionIds.includes(r.id)) }
    case 'store':
      return { type: 'store', stores: STORES.filter((s) => input.storeIds.includes(s.id)).map(({ id, name }) => ({ id, name })) }
  }
}

const storeRef = (id: string) => ({ id, name: STORES.find((x) => x.id === id)?.name ?? id })

/** Status of each store manager's account (three invitations are still open). */
const MANAGER_STATUS: Readonly<Record<string, { status: AdminUser['status']; lastSignIn: string | null; invitedAt: string | null }>> = {
  'st-qc': { status: 'active', lastSignIn: '2026-10-01T07:45:00+08:00', invitedAt: null },
  'st-north-edsa': { status: 'active', lastSignIn: '2026-09-30T18:20:00+08:00', invitedAt: null },
  'st-megamall': { status: 'active', lastSignIn: '2026-10-01T08:05:00+08:00', invitedAt: null },
  'st-pasig': { status: 'invited', lastSignIn: null, invitedAt: '2026-10-01T08:30:00+08:00' },
  'st-moa': { status: 'active', lastSignIn: '2026-09-29T17:10:00+08:00', invitedAt: null },
  'st-aura': { status: 'invited', lastSignIn: null, invitedAt: '2026-10-01T08:31:00+08:00' },
  'st-makati': { status: 'active', lastSignIn: '2026-09-28T12:00:00+08:00', invitedAt: null },
  'st-lp': { status: 'invited', lastSignIn: null, invitedAt: '2026-09-26T14:00:00+08:00' },
}

function seedUsers(): Mutable<AdminUser>[] {
  const hq = (person: (typeof PEOPLE)[keyof typeof PEOPLE], roles: RoleCode[], lastSignIn: string | null, status: AdminUser['status'] = 'active', scope: AdminScopeView = { type: 'global' }): Mutable<AdminUser> => ({
    id: person.id,
    email: person.email,
    name: person.name,
    status,
    roles,
    scope,
    lastSignIn,
    invitedAt: null,
  })
  const staffUser = (staffId: string, lastSignIn: string | null, status: AdminUser['status'] = 'active'): Mutable<AdminUser> => {
    const w = WORLD_STAFF.find((x) => x.id === staffId)
    const name = w?.name ?? staffId
    return { id: `u-stf-${staffId}`, email: staffEmail(name), name, status, roles: ['STF'], scope: { type: 'self', staff: { id: staffId, name } }, lastSignIn, invitedAt: null }
  }
  return [
    hq(PEOPLE.admin, ['ADM'], '2026-10-01T08:55:00+08:00'),
    hq(PEOPLE.planner, ['PLN'], '2026-10-01T09:12:00+08:00'),
    hq(PEOPLE.planner2, ['PLN'], '2026-09-30T17:40:00+08:00', 'active', { type: 'region', regions: REGIONS.filter((r) => r.id !== 'reg-ncr-north') }),
    hq(PEOPLE.hr, ['HR'], '2026-09-30T10:02:00+08:00'),
    hq(PEOPLE.finance, ['FIN'], '2026-10-01T09:15:00+08:00'),
    hq(PEOPLE.executive, ['EXE'], '2026-09-30T16:31:00+08:00'),
    hq(PEOPLE.steward, ['RST'], '2026-09-29T15:22:00+08:00'),
    hq(PEOPLE.formerSteward, ['RST'], '2026-08-12T10:05:00+08:00', 'disabled'),
    ...STORE_MANAGERS.map((m): Mutable<AdminUser> => ({
      id: m.id,
      email: m.email,
      name: m.name,
      status: MANAGER_STATUS[m.storeId]?.status ?? 'active',
      roles: ['STM'],
      scope: { type: 'store', stores: [storeRef(m.storeId)] },
      lastSignIn: MANAGER_STATUS[m.storeId]?.lastSignIn ?? null,
      invitedAt: MANAGER_STATUS[m.storeId]?.invitedAt ?? null,
    })),
    staffUser('st-qc-ft03', '2026-09-30T19:02:00+08:00'),
    staffUser('st-qc-pt05', '2026-10-01T06:40:00+08:00'),
    staffUser('st-north-edsa-pt62', '2026-09-29T21:15:00+08:00'),
    staffUser('st-megamall-xs14', '2026-09-30T12:30:00+08:00'),
    staffUser('st-north-edsa-pt24', '2026-07-30T18:00:00+08:00', 'disabled'),
  ]
}

/** Invitations not yet accepted (SCR-010 System Admin home). */
export const MOCK_PENDING_INVITATIONS = seedUsers().filter((u) => u.status === 'invited').length

type AuditSeed = readonly [at: string, person: { readonly id: string; readonly short: string }, role: RoleCode, action: AuditAction, event: string, objectType: string, objectId: string, objectName: string | null, before: AuditSnapshot, after: AuditSnapshot]

function seedAudit(): MockAuditRow[] {
  const { admin, planner, planner2, hr, finance, executive, steward, formerSteward } = PEOPLE
  const qcManager = STORE_MANAGERS[0] as (typeof STORE_MANAGERS)[number]
  const V = (n: number) => [`scn-xmas-2026-v${n}`, `Christmas 2026 v${n}`] as const
  const rows: readonly AuditSeed[] = [
    ['2026-06-20T10:00:00+08:00', finance, 'FIN', 'publish', 'rule_version.published', 'rule_version', 'rv-wages-2', 'Wage rates (by region) v2', { ncrHourly: 82.5 }, { ncrHourly: 86.875 }],
    ['2026-08-05T11:00:00+08:00', formerSteward, 'RST', 'ingestion', 'dataset.loaded', 'dataset_snapshot', 'snap-master-0805', 'Stores, departments, lanes', null, { rows: 21 }],
    ['2026-08-11T17:05:00+08:00', formerSteward, 'RST', 'ingestion', 'ingestion.failed', 'ingestion_run', 'run-pos-0811', 'pos_export.xlsx.csv', null, { status: 'failed' }],
    ['2026-08-12T09:30:00+08:00', formerSteward, 'RST', 'ingestion', 'dataset.loaded', 'dataset_snapshot', 'snap-pos-0812', 'POS hourly', null, { rows: 28_512 }],
    ['2026-08-29T16:31:00+08:00', formerSteward, 'RST', 'ingestion', 'ingestion.cancelled', 'ingestion_run', 'run-staff-0829', 'staff_roster_draft.csv', { status: 'validated' }, { status: 'cancelled' }],
    ['2026-08-31T17:00:00+08:00', admin, 'ADM', 'role_change', 'user.deactivated', 'user', formerSteward.id, formerSteward.name, { status: 'active' }, { status: 'disabled' }],
    ['2026-09-01T06:00:00+08:00', formerSteward, 'RST', 'ingestion', 'dataset.loaded', 'dataset_snapshot', 'snap-staff-0901', 'Staff roster and availability', null, { rows: WORLD_STAFF.length }],
    ['2026-09-01T09:00:00+08:00', admin, 'ADM', 'create', 'user.invited', 'user', steward.id, steward.name, null, { email: steward.email, roles: ['RST'] }],
    ['2026-09-02T14:00:00+08:00', planner, 'PLN', 'create', 'scenario.created', 'scenario', ...V(1), null, { growth: 1 }],
    ['2026-09-02T15:00:00+08:00', planner, 'PLN', 'submit', 'scenario.submitted', 'scenario', ...V(1), { status: 'draft' }, { status: 'submitted' }],
    ['2026-09-03T10:00:00+08:00', hr, 'HR', 'decision', 'approval.decided', 'scenario', ...V(1), { headcount: 'pending' }, { headcount: 'approved' }],
    ['2026-09-04T16:00:00+08:00', finance, 'FIN', 'decision', 'approval.decided', 'scenario', ...V(1), { budget: 'pending' }, { budget: 'changes_requested' }],
    ['2026-09-05T11:00:00+08:00', planner, 'PLN', 'edit', 'scenario.archived', 'scenario', ...V(1), { status: 'draft' }, { status: 'archived' }],
    ['2026-09-10T09:00:00+08:00', planner, 'PLN', 'create', 'scenario.created', 'scenario', ...V(2), null, { growth: 1.03, parent: 'Christmas 2026 v1' }],
    ['2026-09-10T11:00:00+08:00', planner, 'PLN', 'submit', 'scenario.submitted', 'scenario', ...V(2), { status: 'draft' }, { status: 'submitted' }],
    ['2026-09-11T16:00:00+08:00', executive, 'EXE', 'publish', 'scenario.published', 'scenario', ...V(2), { status: 'approved' }, { status: 'published' }],
    ['2026-09-15T06:00:00+08:00', steward, 'RST', 'ingestion', 'dataset.loaded', 'dataset_snapshot', 'snap-pos-0915', 'POS hourly', null, { rows: 38_016 }],
    ['2026-09-16T10:00:00+08:00', planner, 'PLN', 'create', 'scenario.created', 'scenario', ...V(3), null, { growth: 1.05, parent: 'Christmas 2026 v2' }],
    ['2026-09-16T11:00:00+08:00', planner, 'PLN', 'submit', 'scenario.submitted', 'scenario', ...V(3), { status: 'draft' }, { status: 'submitted' }],
    ['2026-09-17T10:00:00+08:00', hr, 'HR', 'decision', 'approval.decided', 'scenario', ...V(3), { headcount: 'pending' }, { headcount: 'approved' }],
    ['2026-09-17T15:00:00+08:00', finance, 'FIN', 'decision', 'approval.decided', 'scenario', ...V(3), { budget: 'pending' }, { budget: 'approved' }],
    ['2026-09-18T09:00:00+08:00', executive, 'EXE', 'publish', 'scenario.published', 'scenario', ...V(3), { status: 'approved' }, { status: 'published', replaces: 'Christmas 2026 v2' }],
    ['2026-09-18T09:05:00+08:00', executive, 'EXE', 'export', 'summary.exported', 'scenario', ...V(3), null, { format: 'csv' }],
    ['2026-09-20T10:15:00+08:00', steward, 'RST', 'ingestion', 'dataset.loaded', 'dataset_snapshot', 'snap-master-0920', 'Stores, departments, lanes', null, { rows: 24 }],
    ['2026-09-20T14:00:00+08:00', steward, 'RST', 'edit', 'department.updated', 'department', 'st-megamall-d1', 'SM Supermarket – Megamall · Main checkout lanes', { installedLanes: 26 }, { installedLanes: 24 }],
    ['2026-09-21T11:00:00+08:00', planner, 'PLN', 'create', 'saved_view.created', 'saved_view', 'view-seed-1', 'Over capacity — all stores', null, { screen: 'network' }],
    ['2026-09-22T16:00:00+08:00', planner2, 'PLN', 'create', 'scenario.created', 'scenario', ...V(5), null, { growth: 1.12, parent: 'Christmas 2026 v4' }],
    ['2026-09-24T09:00:00+08:00', steward, 'RST', 'submit', 'rule_version.submitted', 'rule_version', 'rv-transport-2', 'Transport allowance v2', { status: 'draft' }, { status: 'submitted' }],
    ['2026-09-24T10:00:00+08:00', planner2, 'PLN', 'create', 'scenario.created', 'scenario', 'scn-xmas-2026-ft5', '5-day FT rule test', null, { ftShiftPattern: '7+1' }],
    ['2026-09-25T11:00:00+08:00', finance, 'FIN', 'decision', 'rule_version.changes_requested', 'rule_version', 'rv-transport-2', 'Transport allowance v2', { status: 'submitted' }, { status: 'changes_requested' }],
    ['2026-09-26T14:00:00+08:00', admin, 'ADM', 'create', 'user.invited', 'user', 'u-stm-fpineda', 'Francis Pineda', null, { email: 'f.pineda@smretail.com', roles: ['STM'] }],
    ['2026-09-27T09:40:00+08:00', steward, 'RST', 'ingestion', 'ingestion.blocked', 'ingestion_run', 'run-pos-0927', 'pos_hourly_aug-dec_2025.csv', null, { errors: 112, warnings: 8 }],
    ['2026-09-27T10:05:00+08:00', steward, 'RST', 'export', 'ingestion.report_exported', 'ingestion_run', 'run-pos-0927', 'pos_hourly_aug-dec_2025.csv', null, { rows: 120 }],
    ['2026-09-28T14:02:00+08:00', steward, 'RST', 'ingestion', 'dataset.loaded', 'dataset_snapshot', 'snap-pos-0928', 'POS hourly', { rows: 38_016 }, { rows: 47_548, staleScenarios: 2 }],
    ['2026-09-28T14:02:00+08:00', steward, 'RST', 'edit', 'scenario.marked_stale', 'scenario', ...V(5), { stale: false }, { stale: true }],
    ['2026-09-29T08:40:00+08:00', planner, 'PLN', 'edit', 'scenario.recalculated', 'scenario', ...V(4), { dataAsOf: '2026-09-15' }, { dataAsOf: '2026-09-28' }],
    ['2026-09-29T09:10:00+08:00', planner, 'PLN', 'submit', 'scenario.submitted', 'scenario', ...V(4), { status: 'draft' }, { status: 'submitted' }],
    ['2026-09-29T11:30:00+08:00', planner, 'PLN', 'submit', 'scenario.submitted', 'scenario', 'scn-ber-2026-v1', 'Ber months 2026 v1', { status: 'draft' }, { status: 'submitted' }],
    ['2026-09-29T15:20:00+08:00', steward, 'RST', 'submit', 'rule_version.submitted', 'rule_version', 'rv-wages-3', 'Wage rates (by region) v3', { status: 'draft' }, { status: 'submitted', ncrHourly: 87.5 }],
    ['2026-09-30T10:00:00+08:00', hr, 'HR', 'decision', 'approval.decided', 'scenario', ...V(4), { headcount: 'pending' }, { headcount: 'approved' }],
    ['2026-09-30T11:00:00+08:00', qcManager, 'STM', 'edit', 'staff.availability_changed', 'staff', 'st-qc-pt06', 'Arlene Mac', { sun: ['morning', 'afternoon', 'evening'] }, { sun: [] }],
    ['2026-09-30T16:30:00+08:00', executive, 'EXE', 'decision', 'approval.secured_outside', 'scenario', ...V(4), { budget: 'pending' }, { budget: 'secured_outside', reference: 'email 30 Sep' }],
    ['2026-09-30T17:00:00+08:00', admin, 'ADM', 'role_change', 'user.scope_changed', 'user', planner2.id, planner2.name, { scope: 'global' }, { scope: 'NCR East, NCR South' }],
    ['2026-10-01T07:10:00+08:00', hr, 'HR', 'create', 'passkey.added', 'passkey', 'pk-ltan-2', 'L. Tan · iPhone', null, { device: 'iPhone' }],
    ['2026-10-01T08:30:00+08:00', admin, 'ADM', 'create', 'user.invited', 'user', 'u-stm-jdelacruz', 'Joel de la Rosa', null, { email: 'j.delarosa@smretail.com', roles: ['STM'] }],
    ['2026-10-01T08:31:00+08:00', admin, 'ADM', 'create', 'user.invited', 'user', 'u-stm-bcastro', 'Bernard Castro', null, { email: 'b.castro@smretail.com', roles: ['STM'] }],
    ['2026-10-01T09:15:00+08:00', finance, 'FIN', 'export', 'hiring_plan.exported', 'scenario', ...V(3), null, { format: 'csv' }],
  ]
  return rows.map(([at, person, activeRole, action, event, objectType, objectId, objectName, before, after], i) => ({
    id: `evt-${i}`,
    at,
    user: { id: person.id, name: person.short },
    activeRole,
    action,
    event,
    objectType,
    objectId,
    objectName,
    before,
    after,
  }))
}

let seq = 0
function fail(code: ApiErrorCode, message: string, details?: ApiErrorDetail[]): ApiResponse {
  seq += 1
  return {
    status: HTTP_STATUS_BY_ERROR_CODE[code],
    body: { error: { code, message, requestId: `mock-adm-${seq}`, ...(details ? { details } : {}) } },
  }
}
const invalid = (path: string, message: string) => fail('validation_failed', 'Some fields are missing or invalid.', [{ path, message }])
const ok = (body: unknown, status = 200): ApiResponse => ({ status, body })

function parseScope(raw: unknown): AdminScopeInput | null {
  const s = (raw ?? {}) as Record<string, unknown>
  const ids = (v: unknown, known: readonly { id: string }[]) =>
    Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && known.some((k) => k.id === x)) ? (v as string[]) : null
  if (s.type === 'global') return { type: 'global' }
  if (s.type === 'region') {
    const regionIds = ids(s.regionIds, REGIONS)
    return regionIds && { type: 'region', regionIds }
  }
  if (s.type === 'store') {
    const storeIds = ids(s.storeIds, STORES)
    return storeIds && { type: 'store', storeIds }
  }
  return null
}

function parseRoles(raw: unknown): RoleCode[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every(isRoleCode)) return null
  return sortRoles(raw)
}

export interface MockAdminStore {
  handle(input: { method: string; pathname: string; query: URLSearchParams; body: unknown; role: RoleCode }): ApiResponse
}

export function createAdminStore(now: () => string = () => demoNow().toISOString()): MockAdminStore {
  const users = seedUsers()
  const events = seedAudit()

  function record(role: RoleCode, e: Omit<MockAuditRow, 'id' | 'at' | 'user' | 'activeRole'>): void {
    events.push({ id: `evt-${events.length}`, at: now(), user: ADMIN, activeRole: role, ...e })
  }
  const snapshot = (u: AdminUser) => ({ name: u.name, status: u.status, roles: [...u.roles], scope: u.scope.type })

  function visibleEvents(role: RoleCode, query: URLSearchParams): MockAuditRow[] {
    const allowed = auditCategoriesFor(role) ?? []
    const category = query.get('category')
    const from = query.get('from')
    const to = query.get('to')
    const userId = query.get('userId')
    const object = query.get('object')?.trim().toLowerCase() ?? ''
    const day = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
    return events
      .filter((e) => allowed.includes(auditEventCategory(e)))
      .filter((e) => !category || auditEventCategory(e) === category)
      .filter((e) => !from || day(e.at) >= from)
      .filter((e) => !to || day(e.at) <= to)
      .filter((e) => !userId || e.user.id === userId)
      .filter((e) => !object || [e.objectType, e.objectId, e.objectName ?? '', e.event].some((v) => v.toLowerCase().includes(object)))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  }

  const entry = (e: MockAuditRow): AuditLogEntry => ({ ...e, category: auditEventCategory(e) })

  function audit(method: string, pathname: string, query: URLSearchParams, role: RoleCode): ApiResponse {
    if (method !== 'GET') return fail('not_found', 'We couldn’t find that.')
    if (!can(role, 'audit_log', 'view')) return fail('forbidden', 'You don’t have access to the audit log.')
    const category = query.get('category')
    if (category && !(AUDIT_EVENT_CATEGORIES as readonly string[]).includes(category)) return invalid('query.category', 'Unknown event type.')
    const from = query.get('from')
    const to = query.get('to')
    if (from && to && from > to) return invalid('query.to', 'The To date is before the From date.')
    const list = visibleEvents(role, query)
    if (pathname === '/audit-events/export') {
      if (!can(role, 'audit_log', 'export')) return fail('forbidden', 'You don’t have access to export the audit log.')
      const content = buildCsvExport({
        title: 'Audit log',
        generatedAt: now(),
        generatedBy: 'juan@smretail.com',
        sampleData: true,
        meta: [
          ['From', from ?? 'any'],
          ['To', to ?? 'any'],
          ['Event type', category ?? 'all'],
        ],
        columns: ['Time', 'User', 'Active role', 'Event', 'Event type', 'Object type', 'Object id', 'Object', 'Detail'],
        rows: list.map((e) => [
          e.at,
          e.user.name,
          e.activeRole,
          e.event,
          auditEventCategory(e),
          e.objectType,
          e.objectId,
          e.objectName ?? '',
          auditChanges(e.before, e.after)
            .map((c) => `${c.field}: ${c.before ?? '—'} → ${c.after ?? '—'}`)
            .join('; '),
        ]),
      })
      record(role, { action: 'export', event: 'export.generated', objectType: 'audit_log', objectId: 'events', objectName: null, before: null, after: { screen: 'SCR-073', format: 'csv', rowCount: list.length } })
      return ok({ fileName: 'audit-log.csv', contentType: 'text/csv', content } satisfies FileDownload)
    }
    if (pathname !== '/audit-events') return fail('not_found', 'We couldn’t find that.')
    const allowed = auditCategoriesFor(role) ?? []
    const actorsById = new Map(events.filter((e) => allowed.includes(auditEventCategory(e))).map((e) => [e.user.id, e.user]))
    const body: AuditLogResponse = {
      events: list.map(entry),
      truncated: false,
      actors: [...actorsById.values()].sort((a, b) => a.name.localeCompare(b.name)),
      categories: allowed,
    }
    return ok(body)
  }

  function admin(method: string, pathname: string, query: URLSearchParams, body: unknown, role: RoleCode): ApiResponse {
    if (!can(role, 'users_roles', 'view')) return fail('forbidden', 'You don’t have access to users and roles.')
    const parts = pathname.split('/').filter(Boolean) // ['admin', 'users' | 'scope-options', id?, action?]
    if (parts[1] === 'scope-options' && parts.length === 2 && method === 'GET') return ok(SCOPE_OPTIONS)
    if (parts[1] !== 'users') return fail('not_found', 'We couldn’t find that.')
    const id = parts[2] ? decodeURIComponent(parts[2]) : null
    const action = parts[3] ?? null
    const b = (body ?? {}) as Record<string, unknown>

    if (id === null) {
      if (method === 'GET') {
        const status = query.get('status') ?? 'all'
        const r = query.get('role')
        const q = query.get('q')?.trim().toLowerCase() ?? ''
        if (!(ADMIN_USER_STATUS_FILTERS as readonly string[]).includes(status)) return invalid('query.status', 'Unknown status.')
        const list = users
          .filter((u) => status === 'all' || u.status === status)
          .filter((u) => !r || u.roles.includes(r as RoleCode))
          .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.includes(q))
          .sort((x, y) => x.name.localeCompare(y.name))
        return ok({ users: list, demoMode: true } satisfies AdminUserListResponse)
      }
      if (method !== 'POST') return fail('not_found', 'We couldn’t find that.')
      const checked = checkInviteEmail(typeof b.email === 'string' ? b.email : '')
      if (!checked.ok) return invalid('body.email', checked.problem === 'required' ? 'Enter a work email.' : DOMAIN_NOT_ALLOWED_MESSAGE)
      const roles = parseRoles(b.roles)
      if (!roles) return invalid('body.roles', 'Choose at least one role.')
      const shared = roles.some((x) => x !== 'STF')
      const scope = shared ? parseScope(b.scope) : { type: 'global' as const }
      if (!scope) return invalid('body.scope', 'Choose a data scope.')
      const staff = STAFF_BY_EMAIL[checked.email]
      if (roles.includes('STF') && !staff) return invalid('body.roles', 'No staff record uses this work email, so the Staff role can’t be linked.')
      const existing = users.find((u) => u.email === checked.email)
      if (existing && existing.status !== 'disabled') return fail('conflict', 'Someone with this work email already has an account. Edit their roles instead.')
      const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim() : checked.email.slice(0, checked.email.indexOf('@'))
      const next: Mutable<AdminUser> = {
        id: existing?.id ?? `u-${users.length + 1}-${checked.email.slice(0, checked.email.indexOf('@')).replace(/[^a-z0-9]/g, '')}`,
        email: checked.email,
        name,
        status: 'invited',
        roles,
        scope: shared ? scopeView(scope) : { type: 'self', staff: staff ?? null },
        lastSignIn: existing?.lastSignIn ?? null,
        invitedAt: now(),
      }
      if (existing) Object.assign(existing, next)
      else users.push(next)
      record(role, {
        action: existing ? 'role_change' : 'create',
        event: existing ? 'user.reinvited' : 'user.invited',
        objectType: 'user',
        objectId: next.id,
        objectName: next.name,
        before: existing ? snapshot(existing) : null,
        after: snapshot(next),
      })
      return ok({ user: next }, 201)
    }

    const user = users.find((u) => u.id === id)
    if (!user) return fail('not_found', 'We couldn’t find that, or you don’t have access to it.')
    if (action === null && method === 'GET') return ok({ user })
    if (!can(role, 'users_roles', 'manage')) return fail('forbidden', 'You don’t have access to users and roles.')
    const before = snapshot(user)

    if (action === null && method === 'PATCH') {
      const roles = b.roles === undefined ? user.roles : parseRoles(b.roles)
      if (!roles) return invalid('body.roles', 'Choose at least one role.')
      const scope = b.scope === undefined ? null : parseScope(b.scope)
      if (b.scope !== undefined && !scope) return invalid('body.scope', 'Choose a data scope.')
      if (roles.includes('STF') && !STAFF_BY_EMAIL[user.email]) return invalid('body.roles', 'No staff record uses this work email, so the Staff role can’t be linked.')
      const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim() : user.name
      const shared = roles.some((x) => x !== 'STF')
      const nextScope: AdminScopeView = !shared ? { type: 'self', staff: STAFF_BY_EMAIL[user.email] ?? null } : scope ? scopeView(scope) : user.scope
      const changed = JSON.stringify([name, roles, nextScope]) !== JSON.stringify([user.name, user.roles, user.scope])
      if (changed) {
        Object.assign(user, { name, roles, scope: nextScope })
        const access = JSON.stringify([roles, nextScope]) !== JSON.stringify([before.roles, before.scope])
        record(role, { action: access ? 'role_change' : 'edit', event: access ? 'user.access_updated' : 'user.updated', objectType: 'user', objectId: user.id, objectName: user.name, before, after: snapshot(user) })
      }
      return ok({ user })
    }
    if (method !== 'POST') return fail('not_found', 'We couldn’t find that.')
    if (action === 'deactivate') {
      if (user.status === 'disabled') return fail('conflict', 'This user is already deactivated.')
      user.status = 'disabled'
      record(role, { action: 'edit', event: 'user.deactivated', objectType: 'user', objectId: user.id, objectName: user.name, before, after: snapshot(user) })
      return ok({ user })
    }
    if (action === 'resend') {
      if (user.status !== 'invited') return fail('conflict', 'Only a pending invitation can be resent.')
      const was = user.invitedAt
      user.invitedAt = now()
      record(role, { action: 'edit', event: 'user.invitation_resent', objectType: 'user', objectId: user.id, objectName: user.name, before: { invitedAt: was }, after: { invitedAt: user.invitedAt } })
      return ok({ user })
    }
    return fail('not_found', 'We couldn’t find that.')
  }

  return {
    handle({ method, pathname, query, body, role }) {
      return pathname.startsWith('/audit-events') ? audit(method, pathname, query, role) : admin(method, pathname, query, body, role)
    },
  }
}
