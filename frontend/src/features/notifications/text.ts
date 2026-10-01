import { isNotificationEvent, type NotificationItem, type NotificationSeverity } from '@lanewise/shared'
import type { StatusTone } from '@/components/ui/status'
import type { I18nContextValue } from '@/i18n'

/**
 * Localised text for a notification (requirement 20.5): the server sends the
 * event and its parameters, the SPA renders them in the reader's language.
 */

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

type Text = Pick<I18nContextValue, 't' | 'formatDateTime'>

export function notificationTitle(item: NotificationItem, { t, formatDateTime }: Text): string {
  const p = item.params
  const startsAt = str(p.startsAt)
  const values = {
    name: item.objectName ?? str(p.name) ?? str(p.scenarioName) ?? t('notifications.object.unnamed'),
    step: str(p.step) ? t(`notifications.step.${String(p.step)}`) : '',
    decision: str(p.decision) ? t(`notifications.decision.${String(p.decision)}`) : '',
    outcome: str(p.outcome) ? t(`notifications.outcome.${String(p.outcome)}`) : '',
    store: str(p.storeName) ?? '',
    fromStore: str(p.fromStore) ?? '',
    when: startsAt ? formatDateTime(startsAt, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '',
  }
  const key = isNotificationEvent(item.event) ? `notifications.event.${item.event}` : 'notifications.event.other'
  return t(key, values)
}

/** Status tone per severity — paired with an icon and text, never colour alone. */
export const SEVERITY_TONE: Readonly<Record<NotificationSeverity, StatusTone>> = {
  info: 'info',
  warning: 'warning',
  critical: 'danger',
}
