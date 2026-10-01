/**
 * Notifications API client (task 19): `/notifications` and
 * `/notification-preferences`. Screens depend on `NotificationsClient` so they
 * render with a fake in tests; the app wires `createNotificationsClient` over
 * the shared API client (`useApi`), so every request carries the active role
 * (`X-Active-Role`) and the server only ever returns the caller's own
 * notifications (P11).
 */
import {
  type MarkNotificationsReadResponse,
  type NotificationFilter,
  type NotificationItem,
  type NotificationListResponse,
  type NotificationPreferencesResponse,
  type UpdateNotificationPreferencesRequest,
} from '@lanewise/shared'
import type { ApiClient } from '@/api'

export interface ListNotificationsOptions {
  readonly filter?: NotificationFilter
  readonly limit?: number
  readonly before?: string
  readonly signal?: AbortSignal
}

export interface NotificationsClient {
  list(options?: ListNotificationsOptions): Promise<NotificationListResponse>
  markRead(id: string): Promise<NotificationItem>
  markAllRead(filter?: NotificationFilter): Promise<MarkNotificationsReadResponse>
  getPreferences(): Promise<NotificationPreferencesResponse>
  updatePreferences(body: UpdateNotificationPreferencesRequest): Promise<NotificationPreferencesResponse>
}

export function createNotificationsClient(api: Pick<ApiClient, 'request'>): NotificationsClient {
  return {
    list: ({ filter, limit, before, signal } = {}) => {
      const params = new URLSearchParams()
      if (filter && filter !== 'all') params.set('filter', filter)
      if (limit !== undefined) params.set('limit', String(limit))
      if (before) params.set('before', before)
      const query = params.toString()
      return api.request<NotificationListResponse>('GET', query ? `/notifications?${query}` : '/notifications', { signal })
    },
    markRead: (id) => api.request<NotificationItem>('POST', `/notifications/${encodeURIComponent(id)}/read`),
    markAllRead: (filter = 'all') =>
      api.request<MarkNotificationsReadResponse>('POST', '/notifications/read-all', { body: { filter } }),
    getPreferences: () => api.request<NotificationPreferencesResponse>('GET', '/notification-preferences'),
    updatePreferences: (body) => api.request<NotificationPreferencesResponse>('PUT', '/notification-preferences', { body }),
  }
}
