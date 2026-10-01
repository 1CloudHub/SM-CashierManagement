import { Menu, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react'
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
 * Wireframe parity: a primary-blue app bar (`--lw-appbar`, `.lw-appbar`
 * re-styles the controls inside it as outlined on-appbar controls) carrying the
 * reversed BrandMark lockup. From tablet up a collapse/expand icon toggle for
 * the docked side nav sits at the far left (`onNavToggle`).
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
  onNavToggle,
  navCollapsed = false,
  navCollapseLabel = 'Collapse navigation',
  navExpandLabel = 'Expand navigation',
  className,
}: {
  /** Tablet and up: collapse/expand the docked side nav. */
  onNavToggle?: () => void
  navCollapsed?: boolean
  navCollapseLabel?: string
  navExpandLabel?: string
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
        'lw-appbar sticky top-0 z-30 flex h-[var(--lw-topbar-h)] min-w-0 items-center gap-2 overflow-x-auto bg-appbar px-2 text-on-appbar tablet:gap-4 tablet:pr-4',
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

      {onNavToggle && (
        <Button
          size="icon"
          variant="ghost"
          aria-label={navCollapsed ? navExpandLabel : navCollapseLabel}
          title={navCollapsed ? navExpandLabel : navCollapseLabel}
          aria-controls="sidenav"
          aria-expanded={!navCollapsed}
          onClick={onNavToggle}
          className="hidden tablet:inline-flex"
        >
          {navCollapsed ? (
            <PanelLeftOpen aria-hidden="true" className="size-5" />
          ) : (
            <PanelLeftClose aria-hidden="true" className="size-5" />
          )}
        </Button>
      )}

      <a
        href="/"
        className="flex shrink-0 items-center self-stretch px-2 no-underline focus-visible:outline-focus-ring"
      >
        {brand ?? (
          <span className="font-weight-bold">
            LaneWise{' '}
            <span className="sr-only text-caption tablet:not-sr-only">{t('shell.byline')}</span>
          </span>
        )}
      </a>

      {search && (
        <div className="hidden min-w-0 max-w-[35rem] flex-1 tablet:flex">
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
