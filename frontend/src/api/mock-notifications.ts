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

const NOW = Date.parse('2026-10-03T10:00:00+08:00')
const V3 = { objectType: 'scenario', objectId: 'scn-xmas-2026-v3', objectName: 'Christmas 2026 v3' } as const
const V4 = { objectType: 'scenario', objectId: 'scn-xmas-2026-v4', objectName: 'Christmas 2026 v4' } as const

const OFFERS_DUE: Omit<Seed, 'id'> = { event: 'hiring.milestone_due', ...V3, ago: 60 * 48 }
const POS_LOADED: Omit<Seed, 'id'> = {
  event: 'ingestion.succeeded',
  objectType: 'ingestion_run',
  objectId: 'run-pos-0928',
  objectName: 'pos_hourly_2026-09.csv',
  params: { datasetType: 'pos', rows: 47_548, staleScenarios: 2 },
  ago: 60 * 24 * 5,
  read: true,
}
const WAGES_PUBLISHED: Omit<Seed, 'id'> = {
  event: 'rule_version.published',
  objectType: 'rule_version',
  objectId: 'rv-wages-2026-2',
  objectName: 'Wage rates v2',
  params: { ruleSetId: 'rules-wages', version: 2 },
  ago: 60 * 24 * 18,
  read: true,
}
const STALE_V4: Omit<Seed, 'id'> = { event: 'scenario.stale', ...V4, params: { reason: 'data_refreshed' }, ago: 60 * 24 * 5 }
const UNFILLED: Omit<Seed, 'id'> = {
  event: 'roster.unfilled_shifts',
  objectType: 'roster',
  objectId: 'roster-qc-main-dec14',
  objectName: 'QC main lanes, Sat Dec 19',
  params: { count: 2 },
  ago: 90,
}

const SEEDS: Readonly<Record<RoleCode, readonly Omit<Seed, 'id'>[]>> = {
  ADM: [OFFERS_DUE, WAGES_PUBLISHED],
  EXE: [
    { event: 'approval.plan_ready', ...V4, ago: 30 },
    OFFERS_DUE,
    { event: 'scenario.published', ...V3, ago: 60 * 24 * 20, read: true },
  ],
  PLN: [
    OFFERS_DUE,
    { event: 'scenario_run.completed', ...V4, ago: 60 * 3 },
    UNFILLED,
    STALE_V4,
    POS_LOADED,
    WAGES_PUBLISHED,
  ],
  STM: [OFFERS_DUE, UNFILLED, { event: 'scenario.published', ...V3, ago: 60 * 24 * 20, read: true }],
  HR: [{ event: 'approval.headcount_requested', ...V4, ago: 45 }, OFFERS_DUE, WAGES_PUBLISHED],
  FIN: [{ event: 'approval.budget_requested', ...V4, ago: 45 }, OFFERS_DUE, WAGES_PUBLISHED],
  RST: [OFFERS_DUE, STALE_V4, POS_LOADED],
  STF: [
    {
      event: 'shift.changed',
      objectType: 'shift_override',
      objectId: 'ovr-pt02-dec19',
      objectName: null,
      params: { change: 'time_change', startsAt: '2026-12-19T12:00:00+08:00', endsAt: '2026-12-19T21:00:00+08:00' },
      ago: 20,
    },
    {
      event: 'offer.sent',
      objectType: 'shift_offer',
      objectId: 'offer-pt02-dec22',
      objectName: null,
      params: { storeName: 'SM Supermarket – Quezon City', startsAt: '2026-12-22T15:00:00+08:00', expiresAt: '2026-12-20T15:00:00+08:00', travelMinutes: 18 },
      ago: 60 * 5,
    },
    { event: 'roster.published', objectType: 'roster', objectId: 'roster-qc-main-dec14', objectName: null, ago: 60 * 24 * 3, read: true },
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
