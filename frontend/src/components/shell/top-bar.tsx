import { Menu, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useUiT } from '@/i18n/context'

/**
 * TopBar (UX-006 navigation, UX-004).
 *
 * The app header from the wireframe: a nav-drawer toggle (mobile), the brand
 * lockup, a search field (collapses to a button on mobile), and a slot for
 * trailing controls (language, "Viewing as" role switcher, notifications bell,
 * user menu). It is a <header> landmark. Interactive slots are passed in so the
 * shell stays composable; icon-only controls here all carry aria-labels.
 *
 * Responsive behaviour follows the design breakpoints (task 1.6): the ≡ menu
 * toggle and the collapsed-search button only appear below `tablet` (< 600px),
 * where the nav lives in a drawer and search opens full-screen. From tablet up
 * the nav is docked (rail, then expanded) and the inline search field shows,
 * so the toggles are hidden.
 *
 * The brand uses the app mark; a text lockup is shown until the SVG mark lands.
 *
 * Narrow screens (~400px): the bar must not overflow. Below tablet the
 * "by SM Retail" byline is visually hidden (still read as part of the brand
 * link), the brand truncates rather than pushing controls off-screen
 * (`min-w-0`), and the trailing slot is expected to collapse secondary
 * controls (role switcher, sign out) into the user menu — AppLayout does.
 * Search: pass `search` to render the inline field (AppShell passes it only
 * from tablet up) and/or `onSearchToggle` for the mobile search button, so the
 * search form is mounted once per breakpoint.
 */
export function TopBar({
  onMenuToggle,
  menuExpanded,
  brand,
  search,
  onSearchToggle,
  trailing,
  className,
}: {
  onMenuToggle?: () => void
  menuExpanded?: boolean
  brand?: React.ReactNode
  /** The inline search form (role="search"); hidden below tablet. */
  search?: React.ReactNode
  /** Renders the mobile (< tablet) search button that opens full-screen search. */
  onSearchToggle?: () => void
  /** Language switcher, role switcher, bell, user menu. */
  trailing?: React.ReactNode
  className?: string
}) {
  const t = useUiT()
  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex min-w-0 items-center gap-2 border-b border-outline bg-surface px-2 py-2 tablet:gap-3 tablet:px-4',
        className,
      )}
    >
      {onMenuToggle && (
        <Button
          size="icon"
          variant="ghost"
          aria-label={t('shell.openNav')}
          aria-controls="sidenav"
          aria-expanded={menuExpanded ?? false}
          onClick={onMenuToggle}
          className="shrink-0 tablet:hidden"
        >
          <Menu aria-hidden="true" className="size-5" />
        </Button>
      )}

      <a
        href="/"
        className="flex min-w-0 items-baseline gap-2 truncate font-weight-bold text-text no-underline focus-visible:outline-focus-ring"
      >
        {brand ?? (
          <>
            LaneWise
            <span className="sr-only text-label text-text-muted tablet:not-sr-only">
              {t('shell.byline')}
            </span>
          </>
        )}
      </a>

      {search && (
        <div className="hidden flex-1 justify-center px-2 tablet:flex">
          {search}
        </div>
      )}

      <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1 tablet:gap-2">
        {onSearchToggle && (
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('shell.searchToggle')}
            onClick={onSearchToggle}
            className="tablet:hidden"
          >
            <Search aria-hidden="true" className="size-5" />
          </Button>
        )}
        {trailing}
      </div>
    </header>
  )
}
