import { cn } from '@/lib/utils'
import logoUrl from '@/assets/1cloudhub-logo.png'

/**
 * "Demo built by 1CloudHub" credit shown at the foot of every screen (the
 * signed-in shell, the sign-in pages and the full-screen status pages).
 *
 * The partner logo is a raster on its own white ground, so it sits on a
 * fixed light chip that reads in both themes. The link opens the 1CloudHub
 * site in a new tab; the logo's alt text carries the name, so the accessible
 * name reads "Demo built by 1CloudHub".
 */
export function DemoCredit({
  label = 'Demo built by',
  newTabLabel = '(opens in a new tab)',
  className,
}: {
  /** Localised lead-in text, e.g. t('brand.demoCredit'). */
  label?: string
  /** Localised screen-reader hint for the new-tab link. */
  newTabLabel?: string
  className?: string
}) {
  return (
    <a
      href="https://www.1cloudhub.com/"
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex items-center gap-3 border border-outline-subtle bg-surface px-3 py-1.5 text-body-sm text-text-muted no-underline motion-interactive hover:text-text focus-visible:outline-focus-ring',
        className,
      )}
    >
      <span>{label}</span>
      <img src={logoUrl} alt="1CloudHub" width={128} height={32} className="h-8 w-auto bg-partner-chip px-1 py-0.5" />
      <span className="sr-only">{newTabLabel}</span>
    </a>
  )
}
