import { NOTIFICATION_FILTERS, type NotificationFilter } from '@lanewise/shared'

export function isNotificationFilter(value: unknown): value is NotificationFilter {
  return typeof value === 'string' && (NOTIFICATION_FILTERS as readonly string[]).includes(value)
}
