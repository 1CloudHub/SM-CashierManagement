import { Fragment } from 'react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import { shortcutAria, shortcutChips, type Shortcut } from '@/lib/keyboard'

/**
 * Keyboard-chip rendering for the shortcut reference (task 1.9, SCR-091).
 *
 * `<Kbd>` is a single key cap; `<ShortcutKeys>` renders a whole binding —
 * either keys pressed together (⌘ K) or a sequence (G then H), with the "then"
 * connector localised. The visible chips are decorative markup; the accessible
 * name of the shortcut is carried by the surrounding row's description, and a
 * combined `aria-label` string is exposed so screen readers hear the keys as
 * one phrase rather than reading each <kbd> tag.
 *
 * Styling follows the design system: square 2px-outlined caps, token type and
 * spacing, no shadow — consistent with SG-006 (square corners, 2px outlines).
 */
export function Kbd({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <kbd
      className={cn(
        'inline-flex min-w-6 items-center justify-center border-2 border-outline bg-surface px-1.5 py-0.5 text-label font-num leading-none text-text',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

export function ShortcutKeys({
  shortcut,
  className,
}: {
  shortcut: Pick<Shortcut, 'keys' | 'sequence'>
  className?: string
}) {
  const { t } = useI18n()
  const then = t('help.keySequenceThen')
  const { chips, sequence } = shortcutChips(shortcut)
  const label = shortcutAria(shortcut, then)

  if (chips.length === 0) return null

  return (
    <span
      className={cn('inline-flex items-center gap-1', className)}
      // Read the whole combo as one phrase, not tag-by-tag.
      role="img"
      aria-label={label}
    >
      {chips.map((tokens, chipIndex) => (
        <Fragment key={chipIndex}>
          {sequence && chipIndex > 0 && (
            <span aria-hidden="true" className="px-0.5 text-body-sm text-text-muted">
              {then}
            </span>
          )}
          <span aria-hidden="true" className="inline-flex items-center gap-0.5">
            {tokens.map((token, tokenIndex) => (
              <Kbd key={tokenIndex}>{token}</Kbd>
            ))}
          </span>
        </Fragment>
      ))}
    </span>
  )
}
