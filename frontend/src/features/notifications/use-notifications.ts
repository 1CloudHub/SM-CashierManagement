import { NOTIFICATION_BELL_LIMIT, type NotificationListResponse } from '@lanewise/shared'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOptionalApi } from '@/api'
import { useActiveRole } from '@/app/active-role'
import { createNotificationsClient, type NotificationsClient } from './api'

/**
 * Notification state shared between the bell and SCR-040: after a change on
 * one (mark read, preferences), the other refreshes via this window event.
 */
export const NOTIFICATIONS_CHANGED = 'lw:notifications-changed'

export function announceNotificationsChanged(): void {
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED))
}

/** The notifications client over the app's API client; `null` outside an ApiProvider. */
export function useNotificationsClient(): NotificationsClient | null {
  const api = useOptionalApi()
  return useMemo(() => (api ? createNotificationsClient(api) : null), [api])
}

/** How often the bell refreshes while the page is open (ms). */
export const BELL_REFRESH_MS = 60_000

/**
 * The bell's data: the latest notifications and the unread count, refreshed
 * on mount, on role switch, when notifications change elsewhere and every
 * minute. A response for a previous role is never shown for the current one.
 */
export function useBellNotifications(client: NotificationsClient | null) {
  const { role } = useActiveRole()
  const [tick, setTick] = useState(0)
  const [result, setResult] = useState<{ role: string; data?: NotificationListResponse; error?: boolean } | null>(null)

  useEffect(() => {
    if (!client) return
    const controller = new AbortController()
    client.list({ limit: NOTIFICATION_BELL_LIMIT, signal: controller.signal }).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ role, data })
      },
      () => {
        if (!controller.signal.aborted) setResult((prev) => ({ role, data: prev?.role === role ? prev.data : undefined, error: true }))
      },
    )
    return () => controller.abort()
  }, [client, role, tick])

  const reload = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    const timer = window.setInterval(reload, BELL_REFRESH_MS)
    window.addEventListener(NOTIFICATIONS_CHANGED, reload)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener(NOTIFICATIONS_CHANGED, reload)
    }
  }, [reload])

  const current = result?.role === role ? result : null
  return { data: current?.data ?? null, error: current?.error ?? false, reload }
}
