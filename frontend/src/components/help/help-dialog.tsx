import { HelpCircle, ExternalLink } from 'lucide-react'
import { useI18n } from '@/i18n'
import { useKeyboardShortcuts } from '@/lib/keyboard'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { buttonVariants } from '@/components/ui/button-variants'
import { Stack } from '@/components/layout/stack'
import { ShortcutReference } from './shortcut-reference'

/**
 * Help and shortcuts screen (task 1.9, SCR-091).
 *
 * A dialog that holds the keyboard-shortcut reference, an in-context "How it
 * works" guide (drawn from the methodology DOM-001 and business rules DOM-003),
 * and links to the methodology and support. It is opened from the user menu,
 * the top-bar Help button, or the `?` shortcut — all of which drive the shared
 * `helpOpen` state on the keyboard engine, so there is a single instance.
 *
 * Built on the existing Radix Dialog primitive, so focus trap, Esc-to-close,
 * aria-modal and labelling are correct by default and motion respects
 * prefers-reduced-motion (handled in the Dialog + motion.css). All copy is
 * localised (en/fil) via the i18n bundle.
 *
 * Mount ONCE near the app root (inside I18nProvider + KeyboardShortcutsProvider)
 * — see @/components/help HelpProvider, which mounts this and registers the `?`
 * / Help open + Esc-close global shortcuts.
 */
export function HelpDialog({
  methodologyHref,
  supportHref,
}: {
  /** Link target for the methodology page (DOM-001). */
  methodologyHref?: string
  /** Link target for support. */
  supportHref?: string
}) {
  const { t } = useI18n()
  const { helpOpen, setHelpOpen } = useKeyboardShortcuts()

  return (
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent
        variant="drawer"
        className="w-full max-w-lg overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle aria-hidden="true" className="size-5" />
            {t('help.title')}
          </DialogTitle>
          <DialogDescription>{t('help.description')}</DialogDescription>
        </DialogHeader>

        <Stack gap={8} className="mt-2">
          {/* In-context "How it works" (DOM-001 / DOM-003). */}
          <section aria-label={t('help.guideHeading')}>
            <h3 className="mb-2 text-h3 text-text">{t('help.guideHeading')}</h3>
            <p className="max-w-prose text-body text-text-muted">
              {t('help.guide.body')}
            </p>
          </section>

          {/* The live shortcut reference. */}
          <ShortcutReference />

          {/* Links to the methodology and support (anchors styled as buttons so
              they remain real links, not JS handlers). */}
          <section className="flex flex-wrap gap-3">
            <a
              href={methodologyHref ?? '#methodology'}
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              {t('help.links.methodology')}
              <ExternalLink aria-hidden="true" className="size-4" />
            </a>
            <a
              href={supportHref ?? '#support'}
              className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            >
              {t('help.links.support')}
              <ExternalLink aria-hidden="true" className="size-4" />
            </a>
          </section>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}
