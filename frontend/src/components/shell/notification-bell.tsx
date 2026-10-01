import { Bell } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button-variants'
import { useUiT } from '@/i18n/context'
import { cn } from '@/lib/utils'

/**
 * NotificationBell (UX-006, UX-004) — the top-bar link to Notifications
 * (SCR-040). The unread count is part of the accessible name as text
 * ("Notifications, 3 unread"), so it never relies on the visual badge; the
 * badge itself is aria-hidden and only shows when there is something unread.
 */
export function NotificationBell({
  href = '/notifications',
  unreadCount = 0,
  className,
}: {
  href?: string
  unreadCount?: number
  className?: string
}) {
  const t = useUiT()
  const label =
    unreadCount > 0
      ? t('shell.notificationsUnread', { count: unreadCount })
      : t('shell.notifications')

  return (
    <a
      href={href}
      aria-label={label}
      title={label}
      className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'relative', className)}
    >
      <Bell aria-hidden="true" className="size-5" />
      {unreadCount > 0 && (
        <span
          aria-hidden="true"
          className="lw-numeric absolute right-1 top-1 min-w-4 rounded-full bg-accent px-1 text-center text-caption text-on-accent"
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </a>
  )
}
