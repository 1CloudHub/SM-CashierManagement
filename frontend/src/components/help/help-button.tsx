import { HelpCircle } from 'lucide-react'
import { useI18n } from '@/i18n'
import { useKeyboardShortcuts } from '@/lib/keyboard'
import { Button } from '@/components/ui/button'

/**
 * HelpButton (task 1.9) — the top-bar / user-menu affordance that opens the
 * Help and shortcuts screen (SCR-091). Pairs with the `?` shortcut so help is
 * discoverable by pointer users too (shortcuts are additive, never the only
 * path). Icon-only by default with a localised aria-label; pass `showLabel` for
 * a labelled variant (e.g. inside the user menu).
 */
export function HelpButton({
  showLabel = false,
  className,
}: {
  showLabel?: boolean
  className?: string
}) {
  const { t } = useI18n()
  const { setHelpOpen } = useKeyboardShortcuts()
  const label = t('help.open')

  if (showLabel) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className={className}
        onClick={() => setHelpOpen(true)}
      >
        <HelpCircle aria-hidden="true" className="size-5" />
        {label}
      </Button>
    )
  }

  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label={label}
      title={label}
      className={className}
      onClick={() => setHelpOpen(true)}
    >
      <HelpCircle aria-hidden="true" className="size-5" />
    </Button>
  )
}
