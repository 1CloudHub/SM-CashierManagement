import { useCallback, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { SkipLink } from '@/components/a11y/skip-link'
import { SideNav, type NavSection } from '@/components/shell/side-nav'
import { TopBar } from '@/components/shell/top-bar'
import { Breadcrumbs, type Crumb } from '@/components/ui/breadcrumbs'
import { Page } from './page'
import { Stack } from './stack'
import { useMediaQuery } from './use-media-query'

/**
 * AppShell (design.md "App shell", Breakpoints; UX-006 navigation; UX-004 a11y).
 *
 * The frame every signed-in screen sits in, wiring the existing shell parts
 * (TopBar, SideNav, Breadcrumbs) to the four design breakpoints without each
 * screen re-implementing the responsive rules. The breakpoints are the
 * token-driven ones (tablet 600 / laptop 1024 / desktop 1440), read via
 * matchMedia so a *single* nav is rendered per state (mounting one <nav> per
 * breakpoint would create duplicate navigation landmarks):
 *
 *   - Laptop (≥1024) / Desktop (≥1440): expanded left nav beside the content.
 *   - Tablet (600–1023): the nav collapses to an icon-only rail (SideNav
 *     `collapsed`).
 *   - Tablet and up, the user can collapse/expand the docked nav with the
 *     icon toggle at its top; the choice overrides the breakpoint default and
 *     persists per browser (localStorage `lw.nav.collapsed`).
 *   - Mobile (<600): the nav moves into a ≡ drawer (TopBar menu toggle opens a
 *     left Drawer), and global search becomes an icon that opens a full-screen
 *     search dialog.
 *
 * Accessibility (task 1.7): the shell owns the landmark + skip-link structure
 * so screens don't re-create it. A <SkipLink> is the first focusable element
 * and jumps to the <main> landmark. Regions map to landmarks: TopBar is the
 * <header> banner, SideNav is the primary <nav>, and content sits in a <main>
 * landmark (via <Page as="main" id="main">) that is focusable (tabIndex -1) so
 * the skip link and route-change focus (useRouteFocus) can land there. The
 * sample-data banner has a dedicated slot that shows on every page while a
 * dataset is flagged synthetic.
 */
export interface AppShellProps {
  /** Grouped, already role-filtered nav sections. */
  nav: NavSection[]
  /** Brand lockup slot for the TopBar (defaults to the text lockup). */
  brand?: ReactNode
  /** The desktop search form (role="search"); also shown full-screen on mobile. */
  search?: ReactNode
  /** Trailing TopBar controls: language switcher, role switcher, bell, user menu. */
  trailing?: ReactNode
  /** Breadcrumb trail shown above the page title. */
  breadcrumbs?: Crumb[]
  /** Sample-data banner (Alert). Rendered in a fixed slot on every page. */
  sampleDataBanner?: ReactNode
  /** Context/scope bar for planning screens (scenario + scope filters). */
  contextBar?: ReactNode
  /** Content max width for the page container. Default "laptop" (1280px). */
  width?: 'laptop' | 'desktop' | 'fluid'
  /** Accessible name for the primary nav. */
  navLabel?: string
  /** Accessible name for the main content landmark (helps when several exist). */
  mainLabel?: string
  /** Label for the skip link (from the i18n bundle; sensible default). */
  skipLinkLabel?: string
  /** Accessible names for the nav collapse/expand toggle (i18n). */
  navCollapseLabel?: string
  navExpandLabel?: string
  children?: ReactNode
}

export function AppShell({
  nav,
  brand,
  search,
  trailing,
  breadcrumbs,
  sampleDataBanner,
  contextBar,
  width = 'laptop',
  navLabel = 'Main',
  mainLabel = 'Main content',
  skipLinkLabel,
  navCollapseLabel,
  navExpandLabel,
  children,
}: AppShellProps) {
  const [navOpen, setNavOpen] = useState(false)
  const [navCollapsedPref, setNavCollapsedPref] = useState<boolean | null>(readNavPref)
  const [searchOpen, setSearchOpen] = useState(false)

  // Design breakpoints (tokens): tablet 600, laptop 1024.
  const isTabletUp = useMediaQuery('(min-width: 37.5rem)')
  const isLaptopUp = useMediaQuery('(min-width: 64rem)')
  const navCollapsed = navCollapsedPref ?? !isLaptopUp
  const toggleNav = useCallback(() => {
    const next = !navCollapsed
    setNavCollapsedPref(next)
    writeNavPref(next)
  }, [navCollapsed])

  return (
    <div className="min-h-screen bg-bg text-text">
      {/* First focusable element: jump past banner + nav to the main landmark. */}
      <SkipLink targetId="main">{skipLinkLabel}</SkipLink>

      <TopBar
        brand={brand}
        onMenuToggle={() => setNavOpen(true)}
        menuExpanded={navOpen}
        search={search}
        onSearchToggle={search ? () => setSearchOpen(true) : undefined}
        trailing={trailing}
      />

      {/* Tablet and up: a single docked nav beside content — an icon rail at
          tablet, expanded from laptop up (breakpoints table). Rendering one
          nav keeps the navigation landmark unique. */}
      <div className={cn(isTabletUp && 'grid grid-cols-[auto_1fr]')}>
        {isTabletUp && (
          <SideNav
            sections={nav}
            label={navLabel}
            collapsed={navCollapsed}
            onToggleCollapsed={toggleNav}
            collapseLabel={navCollapseLabel}
            expandLabel={navExpandLabel}
          />
        )}

        <div className="min-w-0">
          {sampleDataBanner && (
            <div className="pt-3">
              <Page width={width}>{sampleDataBanner}</Page>
            </div>
          )}

          {/* The <main> landmark + skip-link / route-focus target. tabIndex -1
              makes it programmatically focusable without adding it to the tab
              order; aria-label names it for AT. */}
          <Page
            as="main"
            id="main"
            tabIndex={-1}
            aria-label={mainLabel}
            width={width}
            className="py-4 focus-visible:outline-focus-ring"
          >
            <Stack gap={4}>
              {breadcrumbs && breadcrumbs.length > 0 && (
                <Breadcrumbs items={breadcrumbs} />
              )}
              {contextBar}
              {children}
            </Stack>
          </Page>
        </div>
      </div>

      {/* Mobile (< tablet): nav in a left drawer. Radix Dialog gives the focus
          trap, Esc-to-close and aria-modal; the Drawer is labelled by its
          title. The drawer nav keeps the default `sidenav` id so the TopBar
          toggle's aria-controls resolves. Only mounted below tablet so the
          docked nav above stays the single navigation landmark. */}
      {!isTabletUp && (
        <Dialog open={navOpen} onOpenChange={setNavOpen}>
          <DialogContent
            variant="drawer"
            className="left-0 right-auto max-w-xs p-0"
          >
            <DialogTitle className="px-4 pt-4">Navigation</DialogTitle>
            <SideNav sections={nav} label={navLabel} className="border-r-0" />
          </DialogContent>
        </Dialog>
      )}

      {/* Mobile: full-screen search. The desktop search form is reused inside
          a full-bleed dialog so there is a single search implementation. */}
      {search && (
        <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
          <DialogContent
            variant="drawer"
            className={cn('inset-0 h-full w-full max-w-none p-4')}
          >
            <DialogTitle>Search</DialogTitle>
            <div className="mt-2">{search}</div>
            <DialogClose className="sr-only">Close search</DialogClose>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

const NAV_PREF_KEY = 'lw.nav.collapsed'

/** The user's persisted collapse choice, or null to follow the breakpoint. */
function readNavPref(): boolean | null {
  try {
    const v = window.localStorage.getItem(NAV_PREF_KEY)
    return v === 'true' ? true : v === 'false' ? false : null
  } catch {
    return null
  }
}

function writeNavPref(collapsed: boolean): void {
  try {
    window.localStorage.setItem(NAV_PREF_KEY, String(collapsed))
  } catch {
    // Storage unavailable (private mode): the choice lasts for this session only.
  }
}
