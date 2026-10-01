import { Bell } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { AppLink } from '@/app/router'
import { Button } from '@/components/ui/button'
import { STATUS_META } from '@/components/ui/status'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { NotificationsClient } from './api'
import { SEVERITY_TONE, notificationTitle } from './text'
import { announceNotificationsChanged, useBellNotifications, useNotificationsClient } from './use-notifications'

/**
 * Top-bar notifications bell (wireframes/_build.py top bar; requirement 20.6):
 * the unread count and the latest 5, each deep-linking to its object, plus
 * "See all notifications" (SCR-040). A non-modal disclosure: the button is
 * `aria-expanded` / `aria-controls` the panel, Esc closes it and returns
 * focus, an outside click closes it. The count is part of the button's
 * accessible name, not colour or a badge alone.
 */
export function NotificationBell({ client: injected }: { client?: NotificationsClient | null }) {
  const fromApi = useNotificationsClient()
  const client = injected === undefined ? fromApi : injected
  if (!client) return null
  return <BellMenu client={client} />
}

function BellMenu({ client }: { client: NotificationsClient }) {
  const i18n = useI18n()
  const { t } = i18n
  const { data, error, reload } = useBellNotifications(client)
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const unread = data?.unreadCount ?? 0

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  const openItem = (id: string, read: boolean) => {
    setOpen(false)
    if (read) return
    void client
      .markRead(id)
      .then(announceNotificationsChanged)
      .catch(() => undefined)
  }

  return (
    <div ref={rootRef} className="relative">
      <Button
        ref={triggerRef}
        size="icon"
        variant="ghost"
        aria-label={unread > 0 ? t('notifications.bell.labelUnread', { count: unread }) : t('notifications.bell.label')}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          const next = !open
          setOpen(next)
          if (next) void reload()
        }}
        className="relative"
      >
        <Bell aria-hidden="true" className="size-5" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 min-w-5 rounded-full bg-text px-1 text-label leading-5 text-bg"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Button>
      <div
        id={panelId}
        role="region"
        aria-label={t('notifications.bell.menu')}
        hidden={!open}
        className="absolute right-0 top-full z-40 mt-1 w-80 max-w-[90vw] border border-outline bg-surface motion-safe:animate-fade-in"
      >
        {error && !data ? (
          <p className="px-3 py-2 text-body-sm text-text-muted">{t('notifications.bell.error')}</p>
        ) : data && data.items.length === 0 ? (
          <p className="px-3 py-2 text-body-sm text-text-muted">{t('notifications.empty.title')}</p>
        ) : (
          <ul className="flex flex-col">
            {(data?.items ?? []).map((item) => {
              const Icon = STATUS_META[SEVERITY_TONE[item.severity]].icon
              const unreadItem = item.readAt === null
              return (
                <li key={item.id} className="border-b border-outline last:border-b-0">
                  <AppLink
                    href={item.link}
                    onClick={() => openItem(item.id, !unreadItem)}
                    className="flex items-start gap-2 px-3 py-2 text-body-sm text-text no-underline hover:bg-surface-2 focus-visible:outline-focus-ring"
                  >
                    <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', STATUS_META[SEVERITY_TONE[item.severity]].fg)} />
                    <span className="flex flex-col">
                      <span className={cn(unreadItem && 'font-weight-semibold')}>
                        {unreadItem && <span className="sr-only">{t('notifications.unread')}: </span>}
                        {notificationTitle(item, i18n)}
                      </span>
                      <span className="text-label text-text-muted">{i18n.formatDateTime(item.createdAt)}</span>
                    </span>
                  </AppLink>
                </li>
              )
            })}
          </ul>
        )}
        <p className="border-t border-outline px-3 py-2">
          <AppLink
            href="/notifications"
            onClick={() => setOpen(false)}
            className="text-body-sm text-text underline focus-visible:outline-focus-ring"
          >
            {t('notifications.bell.seeAll')}
          </AppLink>
        </p>
      </div>
    </div>
  )
}
