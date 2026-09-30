import { cn } from '@/lib/utils'

/**
 * SkipLink (UX-004, design.md Accessibility: "Landmarks … skip link").
 *
 * The first focusable element on the page. It is visually hidden until it
 * receives keyboard focus, then it appears pinned to the top-left so a keyboard
 * or screen-reader user can jump straight past the banner + nav to the main
 * content. The target defaults to `#main`, the <main> landmark the AppShell
 * renders; that element is made focusable (tabIndex -1) so focus actually lands
 * there when the link is activated.
 *
 * Placement: render it once, as the very first child inside the app root
 * (before the TopBar). The reveal uses only token-driven utilities (surface,
 * outline, focus-ring, spacing) — no raw hex/px — and no motion, so it is
 * instant and unaffected by reduced-motion.
 *
 * The label comes from the i18n bundle (task 1.8); a sensible English default
 * is provided so the shell is usable before bundles are wired in.
 */
export function SkipLink({
  targetId = 'main',
  children,
  className,
}: {
  /** Id of the focus target; must match the landmark's id (default "main"). */
  targetId?: string
  children?: React.ReactNode
  className?: string
}) {
  return (
    <a
      href={`#${targetId}`}
      className={cn(
        // Off-screen until focused: kept in the a11y tree and tab order, not
        // display:none (which would remove it), then revealed on focus.
        'sr-only',
        'focus-visible:not-sr-only focus-visible:fixed focus-visible:left-2 focus-visible:top-2 focus-visible:z-[70]',
        'focus-visible:border-2 focus-visible:border-outline focus-visible:bg-surface',
        'focus-visible:px-3 focus-visible:py-2 focus-visible:text-body focus-visible:text-text focus-visible:no-underline',
        'focus-visible:outline-focus-ring',
        className,
      )}
    >
      {children ?? 'Skip to main content'}
    </a>
  )
}
