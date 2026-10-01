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

const REGIONS = [
  { id: 'region-ncr', name: 'NCR' },
  { id: 'region-luzon', name: 'Luzon' },
] as const

const STORES = [
  { id: 'store-smsm-qc', name: 'SM Supermarket – QC', regionId: 'region-ncr' },
  { id: 'store-sms-manila', name: 'SM Store – Manila', regionId: 'region-ncr' },
  { id: 'store-hyp-pampanga', name: 'SM Hypermarket – Pampanga', regionId: 'region-luzon' },
] as const

const SCOPE_OPTIONS: ScopeOptions = { regions: [...REGIONS], stores: [...STORES] }

/** Staff records a Staff role links to by work email (Q16). */
const STAFF_BY_EMAIL: Readonly<Record<string, { id: string; name: string }>> = {
  'ben.cruz@smretail.com': { id: 'staff-pt-02', name: 'Ben Cruz' },
}

const ADMIN = { id: 'u-adm-juan', name: 'Juan dela Cruz' }

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

function seedUsers(): Mutable<AdminUser>[] {
  return [
    {
      id: 'u-pln-ana',
      email: 'ana@1cloudhub.com',
      name: 'Ana Reyes',
      status: 'active',
      roles: ['PLN'],
      scope: { type: 'region', regions: [REGIONS[1]] },
      lastSignIn: '2026-10-03T09:12:00+08:00',
      invitedAt: null,
    },
    {
      id: 'u-stm-juan',
      email: 'juan@smretail.com',
      name: 'Juan dela Cruz',
      status: 'invited',
      roles: ['STM'],
      scope: { type: 'store', stores: [{ id: STORES[0].id, name: STORES[0].name }] },
      lastSignIn: null,
      invitedAt: '2026-10-02T15:00:00+08:00',
    },
    {
      id: 'u-fin-rsantos',
      email: 'r.santos@smretail.com',
      name: 'R. Santos',
      status: 'active',
      roles: ['FIN'],
      scope: { type: 'global' },
      lastSignIn: '2026-09-30T16:40:00+08:00',
      invitedAt: null,
    },
    {
      id: 'u-rst-lim',
      email: 'k.lim@smretail.com',
      name: 'K. Lim',
      status: 'disabled',
      roles: ['RST'],
      scope: { type: 'global' },
      lastSignIn: '2026-08-12T10:05:00+08:00',
      invitedAt: null,
    },
  ]
}

function seedAudit(): MockAuditRow[] {
  const rows: Omit<MockAuditRow, 'id'>[] = [
    { at: '2026-09-15T11:02:00+08:00', user: { id: 'u-rst-lim', name: 'K. Lim' }, activeRole: 'RST', action: 'publish', event: 'rule_version.published', objectType: 'rule_version', objectId: 'rv-wages-2026-1', objectName: 'Wage rates v1', before: { ncrBaseRate: 85 }, after: { ncrBaseRate: 87 } },
    { at: '2026-09-28T06:00:00+08:00', user: { id: 'u-rst-lim', name: 'K. Lim' }, activeRole: 'RST', action: 'ingestion', event: 'dataset.loaded', objectType: 'dataset_snapshot', objectId: 'snap-pos-0928', objectName: null, before: null, after: { rows: 182_400 } },
    { at: '2026-10-01T16:30:00+08:00', user: { id: 'u-exe-mcruz', name: 'M. Cruz' }, activeRole: 'EXE', action: 'publish', event: 'scenario.published', objectType: 'scenario', objectId: 'scn-xmas-2026-v3', objectName: 'Christmas 2026 v3', before: { status: 'approved' }, after: { status: 'published', replaces: 'Christmas 2026 v2' } },
    { at: '2026-10-02T15:00:00+08:00', user: ADMIN, activeRole: 'ADM', action: 'create', event: 'user.invited', objectType: 'user', objectId: 'u-stm-juan', objectName: 'Juan dela Cruz', before: null, after: { email: 'juan@smretail.com', roles: ['STM'] } },
    { at: '2026-10-03T10:14:00+08:00', user: { id: 'u-pln-ana', name: 'Ana Reyes' }, activeRole: 'PLN', action: 'submit', event: 'scenario.submitted', objectType: 'scenario', objectId: 'scn-xmas-2026-v4', objectName: 'Christmas 2026 v4', before: { status: 'draft' }, after: { status: 'submitted' } },
  ]
  return rows.map((r, i) => ({ id: `evt-${i}`, ...r }))
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

export function createAdminStore(now: () => string = () => new Date().toISOString()): MockAdminStore {
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
      .sort((a, b) => b.at.localeCompare(a.at))
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
