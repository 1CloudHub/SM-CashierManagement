import {
  HTTP_STATUS_BY_ERROR_CODE,
  NOTIFICATION_EVENTS,
  NOTIFICATION_FILTERS,
  NOTIFICATION_FILTER_CATEGORIES,
  NOTIFICATION_PAGE_MAX,
  isMandatoryCategory,
  isNotificationCategory,
  notificationCategory,
  notificationLink,
  resolvePreferences,
  showsInApp,
  type ApiErrorCode,
  type NotificationCategory,
  type NotificationEvent,
  type NotificationFilter,
  type NotificationItem,
  type NotificationListResponse,
  type NotificationPreferenceOverrides,
  type NotificationPreferencesResponse,
  type NotificationSeverity,
  type RoleCode,
} from '@lanewise/shared'
import type { ApiResponse } from './client'
import { DEMO_NOW } from './mock-world'

/**
 * In-memory `/notifications` and `/notification-preferences` for the mock API
 * (task 19). The mock has one demo persona per role, so each role has its own
 * inbox (wireframe bell sample items) and preferences; read state and
 * preference changes persist for the session. Like the API, a role only ever
 * sees its own inbox (P11) and another inbox's id is a 404.
 */

interface Seed {
  readonly id: string
  readonly event: NotificationEvent
  readonly severity?: NotificationSeverity
  readonly objectType: string
  readonly objectId: string
  readonly objectName: string | null
  readonly params?: Record<string, unknown>
  /** Minutes before the mock's "now". */
  readonly ago: number
  readonly read?: boolean
}

const NOW = Date.parse(DEMO_NOW)
const H = 60
const D = 24 * H
const scenario = (id: string, name: string) => ({ objectType: 'scenario', objectId: id, objectName: name }) as const
const V3 = scenario('scn-xmas-2026-v3', 'Christmas 2026 v3')
const V4 = scenario('scn-xmas-2026-v4', 'Christmas 2026 v4')
const V5 = scenario('scn-xmas-2026-v5', 'Christmas 2026 v5 (what-if)')
const FT5 = scenario('scn-xmas-2026-ft5', '5-day FT rule test')
const BER = scenario('scn-ber-2026-v1', 'Ber months 2026 v1')
const QC_ROSTER = { objectType: 'roster', objectId: 'ros-qc-main-2026-12-14', objectName: 'QC main lanes, week of Dec 14' } as const

const OFFERS_DUE: Omit<Seed, 'id'> = { event: 'hiring.milestone_due', ...V3, objectName: 'Christmas 2026 v3 · Offers due Oct 5', ago: 2 * D }
const MILESTONE_OVERDUE: Omit<Seed, 'id'> = { event: 'hiring.milestone_overdue', ...V3, objectName: 'Christmas 2026 v3 · PT requisition (Sep 30)', ago: 10 * H }
const POS_LOADED: Omit<Seed, 'id'> = {
  event: 'ingestion.succeeded',
  objectType: 'ingestion_run',
  objectId: 'run-pos-0928',
  objectName: 'POS hourly (47,548 rows)',
  params: { datasetType: 'pos', rows: 47_548, staleScenarios: 2 },
  ago: 3 * D - 4 * H,
  read: true,
}
const POS_REJECTED: Omit<Seed, 'id'> = {
  event: 'ingestion.failed',
  objectType: 'ingestion_run',
  objectId: 'run-pos-0927',
  objectName: 'pos_hourly_aug-dec_2025.csv (112 errors)',
  params: { datasetType: 'pos', errors: 112 },
  ago: 4 * D,
  read: true,
}
const WAGES_PUBLISHED: Omit<Seed, 'id'> = {
  event: 'rule_version.published',
  objectType: 'rule_version',
  objectId: 'rv-wages-2',
  objectName: 'Wage rates (by region) v2',
  params: { ruleSetId: 'rules-wages', version: 2 },
  ago: 103 * D,
  read: true,
}
const HOLIDAYS_PUBLISHED: Omit<Seed, 'id'> = {
  event: 'rule_version.published',
  objectType: 'rule_version',
  objectId: 'rv-holidays-2',
  objectName: 'Holiday calendar 2026 v2',
  params: { ruleSetId: 'rules-holidays', version: 2 },
  ago: 315 * D,
  read: true,
}
const V3_PUBLISHED: Omit<Seed, 'id'> = { event: 'scenario.published', ...V3, ago: 13 * D, read: true }
const V4_PAUSED: Omit<Seed, 'id'> = { event: 'scenario.paused', ...V4, ago: 3 * D - 4 * H, read: true }
const V4_SECURED: Omit<Seed, 'id'> = { event: 'approval.secured', ...V4, params: { step: 'budget' }, ago: 17 * H + 30 }
const V4_HEADCOUNT: Omit<Seed, 'id'> = { event: 'approval.decided', ...V4, params: { step: 'headcount', decision: 'approved' }, ago: D, read: true }
const LANES_OVER: Omit<Seed, 'id'> = { event: 'plan.lane_capacity_exceeded', ...V4, objectName: 'Christmas 2026 v4 · Megamall main lanes, Dec 24', ago: 2 * D - 2 * H }
const UNFILLED: Omit<Seed, 'id'> = { event: 'roster.unfilled_shifts', ...QC_ROSTER, objectName: 'QC main lanes, Sat Dec 19', params: { count: 2 }, ago: 90 }

const SEEDS: Readonly<Record<RoleCode, readonly Omit<Seed, 'id'>[]>> = {
  ADM: [
    { event: 'passkey.added', objectType: 'passkey', objectId: 'pk-juan-2', objectName: null, ago: 3 * H },
    POS_REJECTED,
    OFFERS_DUE,
    { ...WAGES_PUBLISHED, read: true },
  ],
  EXE: [
    { event: 'approval.plan_ready', ...V4, ago: 17 * H + 30 },
    MILESTONE_OVERDUE,
    LANES_OVER,
    OFFERS_DUE,
    V4_HEADCOUNT,
    V3_PUBLISHED,
    { event: 'scenario.published', ...scenario('scn-xmas-2026-v2', 'Christmas 2026 v2'), ago: 20 * D, read: true },
  ],
  PLN: [
    { event: 'scenario_run.completed', ...V4, ago: 2 * D - H },
    V4_SECURED,
    LANES_OVER,
    { event: 'scenario.stale', ...V5, params: { reason: 'data_refreshed' }, ago: 3 * D - 4 * H },
    { event: 'scenario.stale', ...FT5, params: { reason: 'data_refreshed' }, ago: 3 * D - 4 * H },
    OFFERS_DUE,
    UNFILLED,
    { event: 'offer.resolved', objectType: 'shift_offer', objectId: 'off-seed-4', objectName: null, params: { outcome: 'accepted', storeName: 'SM Supermarket – Megamall' }, ago: 66, read: true },
    { event: 'borrow.decided', objectType: 'borrow_request', objectId: 'bor-nedsa-pasig', objectName: null, params: { outcome: 'approved', fromStore: 'SaveMore – Center Pasig' }, ago: 22 * H, read: true },
    V4_HEADCOUNT,
    { event: 'scenario_run.failed', ...FT5, ago: 7 * D + 2 * H, read: true },
    POS_LOADED,
    POS_REJECTED,
    V3_PUBLISHED,
    { event: 'approval.decided', ...scenario('scn-xmas-2026-v1', 'Christmas 2026 v1'), params: { step: 'budget', decision: 'changes_requested' }, ago: 27 * D, read: true },
    WAGES_PUBLISHED,
  ],
  STM: [
    UNFILLED,
    { event: 'borrow.requested', objectType: 'borrow_request', objectId: 'bor-mega-qc', objectName: null, params: { fromStore: 'SM Supermarket – Quezon City', storeName: 'SM Supermarket – Megamall' }, ago: 3 * H },
    { event: 'staff_request.submitted', objectType: 'staff_request', objectId: 'req-seed-3', objectName: null, params: { type: 'swap', employeeNo: 'PT-05', storeName: 'SM Supermarket – Quezon City' }, ago: 4 * H },
    { event: 'staff_request.submitted', objectType: 'staff_request', objectId: 'req-seed-1', objectName: null, params: { type: 'time_off', employeeNo: 'PT-02', storeName: 'SM Supermarket – Quezon City' }, ago: 7 * H },
    { event: 'staff_request.submitted', objectType: 'staff_request', objectId: 'req-seed-2', objectName: null, params: { type: 'time_off', employeeNo: 'PT-06', storeName: 'SM Supermarket – Quezon City' }, ago: 6 * H, read: true },
    { event: 'offer.resolved', objectType: 'shift_offer', objectId: 'off-seed-3', objectName: null, params: { outcome: 'declined', storeName: 'SM Supermarket – Quezon City' }, ago: 5 },
    { event: 'borrow.decided', objectType: 'borrow_request', objectId: 'bor-qc-mega', objectName: null, params: { outcome: 'declined', fromStore: 'SM Supermarket – Megamall' }, ago: 28 * H, read: true },
    { event: 'roster.override_rule_breach', ...QC_ROSTER, params: { startsAt: '2026-12-17T08:00:00+08:00', rule: 'MIN_REST' }, ago: 2 * D, read: true },
    { event: 'roster.published', ...QC_ROSTER, ago: 3 * D, read: true },
    V3_PUBLISHED,
  ],
  HR: [
    { event: 'approval.headcount_requested', ...BER, ago: 2 * D - 90 },
    MILESTONE_OVERDUE,
    OFFERS_DUE,
    V4_SECURED,
    V4_PAUSED,
    V3_PUBLISHED,
    WAGES_PUBLISHED,
  ],
  FIN: [
    { event: 'approval.budget_requested', ...BER, ago: 2 * D - 90 },
    V4_SECURED,
    V4_HEADCOUNT,
    V4_PAUSED,
    OFFERS_DUE,
    V3_PUBLISHED,
    WAGES_PUBLISHED,
  ],
  RST: [
    { ...POS_LOADED, read: false },
    { ...POS_REJECTED, read: false },
    OFFERS_DUE,
    WAGES_PUBLISHED,
    HOLIDAYS_PUBLISHED,
  ],
  STF: [
    {
      event: 'shift.changed',
      objectType: 'shift_override',
      objectId: 'ovr-seed-1',
      objectName: null,
      params: { change: 'time_change', startsAt: '2026-12-19T12:00:00+08:00', endsAt: '2026-12-19T21:00:00+08:00' },
      ago: 20,
    },
    {
      event: 'offer.sent',
      objectType: 'shift_offer',
      objectId: 'off-seed-7',
      objectName: null,
      params: { storeName: 'SM Supermarket – Megamall', startsAt: '2026-12-20T13:00:00+08:00', travelMinutes: 22 },
      ago: 6,
    },
    { event: 'offer.resolved', objectType: 'shift_offer', objectId: 'off-seed-8', objectName: null, params: { outcome: 'accepted', storeName: 'SM Hypermarket – North EDSA' }, ago: 20 * H, read: true },
    { event: 'staff_request.decided', objectType: 'staff_request', objectId: 'req-seed-4', objectName: null, params: { type: 'swap', outcome: 'declined' }, ago: 2 * D, read: true },
    { event: 'roster.published', ...QC_ROSTER, objectName: null, ago: 3 * D, read: true },
  ],
}

interface Row {
  readonly item: Omit<NotificationItem, 'readAt'>
  readAt: string | null
}

function seedInbox(role: RoleCode): Row[] {
  return SEEDS[role].map((s, i) => {
    const params = s.params ?? {}
    const createdAt = new Date(NOW - s.ago * 60_000).toISOString()
    return {
      item: {
        id: `ntf-${role.toLowerCase()}-${i + 1}`,
        event: s.event,
        category: notificationCategory(s.event),
        severity: s.severity ?? NOTIFICATION_EVENTS[s.event].severity,
        objectType: s.objectType,
        objectId: s.objectId,
        objectName: s.objectName,
        params,
        link: notificationLink({ event: s.event, objectType: s.objectType, objectId: s.objectId, params }),
        createdAt,
        synthetic: true,
      },
      readAt: s.read ? createdAt : null,
    }
  })
}

function fail(code: ApiErrorCode, message: string): ApiResponse {
  return { status: HTTP_STATUS_BY_ERROR_CODE[code], body: { error: { code, message, requestId: 'mock-notifications' } } }
}

export interface NotificationRequest {
  readonly method: string
  readonly pathname: string
  readonly query: URLSearchParams
  readonly body: unknown
  readonly role: RoleCode
}

export function createNotificationStore() {
  const inboxes = new Map<RoleCode, Row[]>()
  const prefs = new Map<RoleCode, NotificationPreferenceOverrides>()
  const inbox = (role: RoleCode) => {
    let rows = inboxes.get(role)
    if (!rows) {
      rows = seedInbox(role)
      inboxes.set(role, rows)
    }
    return rows
  }
  const overrides = (role: RoleCode) => prefs.get(role) ?? {}
  const visible = (role: RoleCode, row: Row) => showsInApp(row.item.event, row.item.severity, overrides(role))
  const inFilter = (row: Row, filter: NotificationFilter) => {
    if (filter === 'all') return true
    if (filter === 'unread') return row.readAt === null
    const category = row.item.category
    return category !== null && NOTIFICATION_FILTER_CATEGORIES[filter].includes(category)
  }
  const unread = (role: RoleCode) => inbox(role).filter((r) => r.readAt === null && visible(role, r)).length
  const now = () => new Date().toISOString()

  function list(role: RoleCode, query: URLSearchParams): ApiResponse {
    const rawFilter = query.get('filter') ?? 'all'
    if (!(NOTIFICATION_FILTERS as readonly string[]).includes(rawFilter)) return fail('validation_failed', 'Unknown filter.')
    const filter = rawFilter as NotificationFilter
    const limit = Math.min(Math.max(Number(query.get('limit') ?? 20) || 20, 1), NOTIFICATION_PAGE_MAX)
    const before = query.get('before')
    const rows = inbox(role)
      .filter((r) => visible(role, r) && inFilter(r, filter) && (!before || r.item.createdAt < before))
      .sort((a, b) => b.item.createdAt.localeCompare(a.item.createdAt))
    const page = rows.slice(0, limit)
    const body: NotificationListResponse = {
      items: page.map((r) => ({ ...r.item, readAt: r.readAt })),
      unreadCount: unread(role),
      nextBefore: rows.length > limit ? (page.at(-1)?.item.createdAt ?? null) : null,
    }
    return { status: 200, body }
  }

  function preferences(role: RoleCode): NotificationPreferencesResponse {
    return { language: 'en', preferences: resolvePreferences(overrides(role)) }
  }

  return {
    handle({ method, pathname, query, body, role }: NotificationRequest): ApiResponse {
      if (pathname === '/notifications' && method === 'GET') return list(role, query)
      if (pathname === '/notifications/read-all' && method === 'POST') {
        const filter = ((body as { filter?: NotificationFilter } | undefined)?.filter ?? 'all') as NotificationFilter
        let updated = 0
        for (const r of inbox(role)) {
          if (r.readAt === null && inFilter(r, filter === 'unread' ? 'all' : filter)) {
            r.readAt = now()
            updated += 1
          }
        }
        return { status: 200, body: { updated, unreadCount: unread(role) } }
      }
      const m = /^\/notifications\/([^/]+)\/read$/.exec(pathname)
      if (m && method === 'POST') {
        const row = inbox(role).find((r) => r.item.id === decodeURIComponent(m[1] ?? ''))
        if (!row) return fail('not_found', 'We couldn’t find that.')
        row.readAt ??= now()
        return { status: 200, body: { ...row.item, readAt: row.readAt } }
      }
      if (pathname === '/notification-preferences' && method === 'GET') return { status: 200, body: preferences(role) }
      if (pathname === '/notification-preferences' && method === 'PUT') {
        const changes = (body as { preferences?: { category: string; inApp?: boolean; email?: boolean }[] } | undefined)?.preferences
        if (!Array.isArray(changes) || changes.length === 0) return fail('validation_failed', 'Nothing to change.')
        const next: Record<string, { in_app?: boolean; email?: boolean }> = { ...overrides(role) }
        for (const c of changes) {
          if (!isNotificationCategory(c.category)) return fail('validation_failed', 'Unknown notification category.')
          const category: NotificationCategory = c.category
          if (isMandatoryCategory(category) && (c.inApp === false || c.email === false)) {
            return fail('validation_failed', 'Approvals and security notifications can’t be turned off.')
          }
          next[category] = {
            ...next[category],
            ...(c.inApp === undefined ? {} : { in_app: c.inApp }),
            ...(c.email === undefined ? {} : { email: c.email }),
          }
        }
        prefs.set(role, next as NotificationPreferenceOverrides)
        return { status: 200, body: preferences(role) }
      }
      return fail('not_found', 'We couldn’t find that.')
    },
  }
}
