import {
  NOTIFICATION_FILTERS,
  NOTIFICATION_PAGE_MAX,
  type NotificationFilter,
  type NotificationItem,
  type NotificationListResponse,
} from '@lanewise/shared'
import { useCallback, useEffect, useState } from 'react'
import { AppLink } from '@/app/router'
import { Cluster, Stack } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { CardSkeleton } from '@/components/ui/card'
import { Pill, StatusPill } from '@/components/ui/pill'
import { StateBlock } from '@/components/ui/state-block'
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableWrap } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useI18n } from '@/i18n'
import type { NotificationsClient } from './api'
import { PreferencesDialog } from './preferences-dialog'
import { SEVERITY_TONE, notificationTitle } from './text'
import { NOTIFICATIONS_CHANGED, announceNotificationsChanged } from './use-notifications'

export interface NotificationsScreenProps {
  readonly client: NotificationsClient
  /** The selected filter tab (kept in the URL by the page). */
  readonly filter: NotificationFilter
  readonly onFilterChange: (filter: NotificationFilter) => void
}

const PAGE = 20

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly data: NotificationListResponse }

/**
 * SCR-040 Notifications (wireframes/scr-040-notifications.html; requirement
 * 20): the caller's own notifications (P11) with All / Unread / Approvals /
 * Plans / Data / Rules tabs, an unread marker that pairs text with the dot,
 * a deep link per item, "Mark all read" and the preferences dialog. Text is
 * rendered in the reader's language from the event and its parameters.
 */
export function NotificationsScreen({ client, filter, onFilterChange }: NotificationsScreenProps) {
  const i18n = useI18n()
  const { t, formatDateTime } = i18n
  const [tick, setTick] = useState(0)
  const [result, setResult] = useState<{ filter: NotificationFilter; load: Load } | null>(null)
  const [older, setOlder] = useState<{ items: NotificationItem[]; nextBefore: string | null } | null>(null)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    client.list({ filter, limit: PAGE, signal: controller.signal }).then(
      (data) => {
        if (controller.signal.aborted) return
        setResult({ filter, load: { kind: 'ready', data } })
        setOlder(null)
      },
      () => {
        if (!controller.signal.aborted) setResult({ filter, load: { kind: 'error' } })
      },
    )
    return () => controller.abort()
  }, [client, filter, tick])

  const refresh = useCallback(() => setTick((n) => n + 1), [])
  useEffect(() => {
    window.addEventListener(NOTIFICATIONS_CHANGED, refresh)
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED, refresh)
  }, [refresh])

  // Keep showing this filter's last result while it refreshes; another filter's never.
  const load: Load = result?.filter === filter ? result.load : { kind: 'loading' }
  const data = load.kind === 'ready' ? load.data : null
  const items = [...(data?.items ?? []), ...(older?.items ?? [])]
  const nextBefore = older ? older.nextBefore : (data?.nextBefore ?? null)
  const unreadCount = data?.unreadCount ?? 0

  const markAll = async () => {
    setBusy(true)
    try {
      await client.markAllRead(filter === 'unread' ? 'all' : filter)
      setStatus(t('notifications.announce.allRead'))
      announceNotificationsChanged()
    } catch {
      setResult({ filter, load: { kind: 'error' } })
    } finally {
      setBusy(false)
    }
  }

  const markOne = async (id: string) => {
    try {
      await client.markRead(id)
      announceNotificationsChanged()
    } catch {
      // The list stays as it was; the next refresh shows the real state.
    }
  }

  const showOlder = async () => {
    if (!nextBefore) return
    setBusy(true)
    try {
      const res = await client.list({ filter, limit: Math.min(PAGE, NOTIFICATION_PAGE_MAX), before: nextBefore })
      setOlder({ items: [...(older?.items ?? []), ...res.items], nextBefore: res.nextBefore })
    } catch {
      setResult({ filter, load: { kind: 'error' } })
    } finally {
      setBusy(false)
    }
  }

  let body: React.ReactNode
  if (load.kind === 'loading') {
    body = <CardSkeleton label={t('state.loading')} />
  } else if (load.kind === 'error') {
    body = (
      <StateBlock
        variant="error"
        title={t('notifications.error.title')}
        description={t('state.error.description')}
        action={<Button onClick={refresh}>{t('action.retry')}</Button>}
      />
    )
  } else if (items.length === 0) {
    body = <StateBlock title={t('notifications.empty.title')} description={t('notifications.empty.description')} />
  } else {
    body = (
      <Stack gap={3}>
        <TableWrap>
          <Table aria-label={t('notifications.list.label')}>
            <TableHead>
              <TableRow>
                <TableHeaderCell scope="col">
                  <span className="sr-only">{t('notifications.unread')}</span>
                </TableHeaderCell>
                <TableHeaderCell scope="col">{t('notifications.col.event')}</TableHeaderCell>
                <TableHeaderCell scope="col">{t('notifications.col.when')}</TableHeaderCell>
                <TableHeaderCell scope="col">{t('notifications.col.link')}</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item) => {
                const unread = item.readAt === null
                const tone = SEVERITY_TONE[item.severity]
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      {unread ? (
                        <span>
                          <span aria-hidden="true">●</span>
                          <span className="sr-only">{t('notifications.unread')}</span>
                        </span>
                      ) : (
                        <span className="sr-only">{t('notifications.read')}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Cluster gap={2} align="center">
                        {item.severity !== 'info' && (
                          <StatusPill tone={tone}>{t(`notifications.severity.${item.severity}`)}</StatusPill>
                        )}
                        <span className={unread ? 'font-weight-semibold text-text' : 'text-text'}>{notificationTitle(item, i18n)}</span>
                        {item.synthetic && <Pill>{t('notifications.demo')}</Pill>}
                      </Cluster>
                    </TableCell>
                    <TableCell>
                      <time dateTime={item.createdAt} className="whitespace-nowrap">
                        {formatDateTime(item.createdAt)}
                      </time>
                    </TableCell>
                    <TableCell>
                      <Cluster gap={2} align="center">
                        <AppLink
                          href={item.link}
                          onClick={() => (unread ? void markOne(item.id) : undefined)}
                          className="text-body text-text underline focus-visible:outline-focus-ring"
                        >
                          {t('notifications.open')}
                        </AppLink>
                        {unread && (
                          <Button size="sm" variant="ghost" onClick={() => void markOne(item.id)}>
                            {t('notifications.markRead')}
                          </Button>
                        )}
                      </Cluster>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableWrap>
        {nextBefore && (
          <div>
            <Button variant="secondary" disabled={busy} onClick={() => void showOlder()}>
              {t('notifications.showOlder')}
            </Button>
          </div>
        )}
      </Stack>
    )
  }

  return (
    <Stack gap={4}>
      <Cluster gap={3} align="center" justify="between">
        <h1 className="text-h1 text-text">{t('screen.notifications')}</h1>
        <Cluster gap={2}>
          <Button variant="secondary" disabled={busy || unreadCount === 0} onClick={() => void markAll()}>
            {t('notifications.markAllRead')}
          </Button>
          <Button variant="secondary" onClick={() => setPrefsOpen(true)}>
            {t('notifications.preferences')}
          </Button>
        </Cluster>
      </Cluster>
      <p role="status" className="sr-only">
        {status}
      </p>
      <Tabs value={filter} onValueChange={(v) => onFilterChange(v as NotificationFilter)}>
        <TabsList aria-label={t('notifications.filters.label')}>
          {NOTIFICATION_FILTERS.map((f) => (
            <TabsTrigger key={f} value={f}>
              {f === 'unread' ? t('notifications.filter.unread', { count: unreadCount }) : t(`notifications.filter.${f}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {NOTIFICATION_FILTERS.map((f) => (
          <TabsContent key={f} value={f}>
            {f === filter ? body : null}
          </TabsContent>
        ))}
      </Tabs>
      <PreferencesDialog client={client} open={prefsOpen} onOpenChange={setPrefsOpen} onSaved={(msg) => setStatus(msg)} />
    </Stack>
  )
}
