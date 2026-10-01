import { ChevronDown, CircleHelp, LogOut, UserRound } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useUiT } from '@/i18n/context'
import { cn } from '@/lib/utils'

/**
 * UserMenu (UX-006, UX-004) — the account control at the end of the top bar.
 *
 * A disclosure popover (button with aria-expanded + aria-controls, a labelled
 * non-modal panel), not an ARIA `menu`: its content mixes links, a sign-out
 * button and, below tablet, the "Viewing as" switcher (`children`), which a
 * menu role cannot hold. It closes on Esc (focus back to the trigger), on an
 * outside pointer press, when focus leaves it, and after choosing a link.
 * Every row is a ≥44px target.
 */
export function UserMenu({
  name,
  email,
  profileHref = '/profile',
  helpHref = '/help',
  onSignOut,
  children,
  className,
}: {
  name?: string
  email?: string
  profileHref?: string
  helpHref?: string
  onSignOut?: () => void
  /** Extra controls shown above the links (e.g. the role switcher on mobile). */
  children?: ReactNode
  className?: string
}) {
  const t = useUiT()
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  const row =
    'flex min-h-tap w-full items-center gap-2 px-3 text-left text-body text-text no-underline motion-interactive hover:bg-surface-2 focus-visible:outline-focus-ring'

  return (
    <div
      ref={rootRef}
      className={cn('relative', className)}
      onBlur={(e) => {
        if (open && !e.currentTarget.contains(e.relatedTarget)) setOpen(false)
      }}
    >
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        aria-label={t('shell.userMenu')}
        aria-expanded={open}
        aria-controls={panelId}
        className="gap-1 px-2"
        onClick={() => setOpen((o) => !o)}
      >
        <UserRound aria-hidden="true" className="size-5" />
        <ChevronDown aria-hidden="true" className="size-4" />
      </Button>

      {open && (
        <div
          id={panelId}
          role="group"
          aria-label={t('shell.userMenu')}
          className="absolute right-0 top-full z-40 mt-1 w-72 max-w-[calc(100vw-2rem)] border border-outline bg-surface py-2 motion-safe:animate-fade-in"
        >
          {(name || email) && (
            <div className="border-b border-outline-subtle px-3 pb-2">
              {name && <p className="truncate font-weight-semibold text-text">{name}</p>}
              {email && <p className="truncate text-body-sm text-text-muted">{email}</p>}
            </div>
          )}
          {children && (
            <div className="border-b border-outline-subtle px-3 py-2">{children}</div>
          )}
          <ul className="py-1">
            <li>
              <a href={profileHref} className={row} onClick={() => setOpen(false)}>
                <UserRound aria-hidden="true" className="size-4" />
                {t('shell.userMenu.profile')}
              </a>
            </li>
            <li>
              <a href={helpHref} className={row} onClick={() => setOpen(false)}>
                <CircleHelp aria-hidden="true" className="size-4" />
                {t('shell.userMenu.help')}
              </a>
            </li>
            {onSignOut && (
              <li className="mt-1 border-t border-outline-subtle pt-1">
                <button
                  type="button"
                  className={row}
                  onClick={() => {
                    setOpen(false)
                    onSignOut()
                  }}
                >
                  <LogOut aria-hidden="true" className="size-4" />
                  {t('shell.userMenu.signOut')}
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
