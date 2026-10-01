import { useEffect, useId, useRef, useState } from 'react'
import { Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'

/**
 * InfoPopover (task 1.9 — UX-004: "never rely on a tooltip alone for essential
 * information").
 *
 * A small info affordance for field-level help: an icon button that toggles a
 * plain-language explanation. Unlike a hover tooltip, the content is:
 *   - available to keyboard users (it is a real <button> that toggles on
 *     click/Enter/Space),
 *   - available to screen readers (the button is `aria-expanded` +
 *     `aria-controls` the panel, and the panel is a labelled region), and
 *   - dismissable (Esc, outside click, or toggling the button) — WCAG 2.2
 *     "content on hover or focus" is satisfied because showing it does not
 *     depend on hover.
 *
 * It is deliberately NON-MODAL: it does not trap focus or block the page, so it
 * suits inline field hints (design rule: shortcuts/popovers never trap focus).
 * For essential info, prefer pairing this with visible hint text on the Field;
 * this popover is for the "why / how it's calculated" detail (DOM-001/DOM-003).
 *
 * Motion: the panel uses the token-driven `animate-fade-in`, which collapses to
 * an instant fade under prefers-reduced-motion (motion.css). No raw timings.
 */
export function InfoPopover({
  /** The explanation shown in the panel. Already localised by the caller. */
  children,
  /** Accessible name for the trigger button (localised). Defaults to a generic label. */
  triggerLabel,
  /** Optional heading for the panel content. */
  title,
  className,
  /** Placement relative to the trigger. Default below-start. */
  align = 'start',
}: {
  children: React.ReactNode
  triggerLabel?: string
  title?: React.ReactNode
  className?: string
  align?: 'start' | 'end'
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const rootRef = useRef<HTMLSpanElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const label = triggerLabel ?? t('infoPopover.trigger')

  // Close on Esc (returning focus to the trigger) and on outside interaction.
  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    function onPointerDown(event: PointerEvent) {
      if (
        rootRef.current &&
        event.target instanceof Node &&
        !rootRef.current.contains(event.target)
      ) {
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

  return (
    <span ref={rootRef} className={cn('relative inline-flex', className)}>
      <Button
        ref={triggerRef}
        type="button"
        size="icon"
        variant="ghost"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <Info aria-hidden="true" className="size-4" />
      </Button>

      {open && (
        <div
          id={panelId}
          role="group"
          aria-label={typeof title === 'string' ? title : label}
          className={cn(
            'absolute top-full z-40 mt-1 w-64 border border-outline bg-surface p-3 text-body-sm text-text motion-safe:animate-fade-in',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          <div className="flex items-start justify-between gap-2">
            {title && <p className="text-label text-text">{title}</p>}
            <Button
              size="icon"
              variant="ghost"
              aria-label={t('infoPopover.close')}
              className="-mr-1 -mt-1 ml-auto size-6 min-h-0 min-w-0"
              onClick={() => {
                setOpen(false)
                triggerRef.current?.focus()
              }}
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          </div>
          <div className={cn(title && 'mt-1', 'text-text-muted')}>{children}</div>
        </div>
      )}
    </span>
  )
}
