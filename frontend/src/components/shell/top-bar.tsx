import { Menu, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

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
  /** The search form (role="search"); hidden on mobile behind the toggle. */
  search?: React.ReactNode
  onSearchToggle?: () => void
  /** Language switcher, role switcher, bell, user menu. */
  trailing?: React.ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex items-center gap-3 border-b border-outline bg-surface px-4 py-2',
        className,
      )}
    >
      {onMenuToggle && (
        <Button
          size="icon"
          variant="ghost"
          aria-label="Open navigation"
          aria-controls="sidenav"
          aria-expanded={menuExpanded ?? false}
          onClick={onMenuToggle}
          className="tablet:hidden"
        >
          <Menu aria-hidden="true" className="size-5" />
        </Button>
      )}

      <a
        href="/"
        className="flex items-baseline gap-2 font-weight-bold text-text no-underline focus-visible:outline-focus-ring"
      >
        {brand ?? (
          <>
            LaneWise
            <span className="text-label text-text-muted">by SM Retail</span>
          </>
        )}
      </a>

      {search && (
        <div className="hidden flex-1 justify-center px-2 tablet:flex">
          {search}
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        {search && onSearchToggle && (
          <Button
            size="icon"
            variant="ghost"
            aria-label="Search"
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
