import { BrandMark } from '@/components/brand'
import { createContext, useContext, type MouseEvent, type ReactNode } from 'react'
import { AppShell, useMediaQuery } from '@/components/layout'
import { ThemeToggle, UserMenu, type NavSection } from '@/components/shell'
import { Alert } from '@/components/ui/alert'
import type { Crumb } from '@/components/ui/breadcrumbs'
import { useDocumentTitle } from '@/features/auth/use-document-title'
import { NotificationBell } from '@/features/notifications/notification-bell'
import { GlobalSearch } from '@/features/search/global-search'
import { LanguageSwitcher, useI18n } from '@/i18n'
import { canAccess, navForRole, screenForPath } from './access'
import { useActiveRole } from './active-role'
import { API_MOCK } from './config'
import { RoleSwitcher } from './role-switcher'
import { isPlainLeftClick } from './links'
import { useRouter } from './router'

/**
 * The signed-in frame (design.md › App shell): AppShell wired to the active
 * role — nav filtered to what the role may open (requirement 2.3), "Viewing
 * as" switcher, language, theme toggle, notifications bell (task 19), account menu,
 * global search, breadcrumb, sample-data banner and page title. Screens render
 * inside it.
 */

export const GLOBAL_SEARCH_ID = 'global-search'

/** The signed-in account, filled in by the app root (it needs auth). */
export interface ShellAccount {
  readonly email: string
  readonly name?: string
  readonly onSignOut: () => void
}

/** Slots the app root fills in (e.g. the account, which needs auth). */
export interface ShellSlots {
  readonly account?: ShellAccount
}

const ShellSlotsContext = createContext<ShellSlots>({})
export const ShellSlotsProvider = ShellSlotsContext.Provider

export function useShellSlots(): ShellSlots {
  return useContext(ShellSlotsContext)
}

/**
 * The account menu for the top bar: name / email, Profile, Help and
 * shortcuts, Sign out. `roleSwitcher` is shown inside it on narrow screens,
 * where the top bar has no room for the "Viewing as" control.
 */
export function AppUserMenu({ roleSwitcher }: { roleSwitcher?: ReactNode }) {
  const { account } = useShellSlots()
  return (
    <UserMenu name={account?.name} email={account?.email} onSignOut={account?.onSignOut}>
      {roleSwitcher}
    </UserMenu>
  )
}

export function AppLayout({
  title,
  crumbs,
  contextBar,
  children,
}: {
  /** Document title (already localised). */
  title: string
  /** Breadcrumb trail after Home; the last item is the current page. */
  crumbs: Crumb[]
  /** Planning screens: the context bar (scenario + scope filters, saved views). */
  contextBar?: ReactNode
  children: ReactNode
}) {
  const { t } = useI18n()
  const { role } = useActiveRole()
  const { location, navigate } = useRouter()
  const isTabletUp = useMediaQuery('(min-width: 37.5rem)')
  useDocumentTitle(t('shell.pageTitle', { title }))

  const current = screenForPath(location.pathname)
  const nav: NavSection[] = navForRole(role).map((section) => ({
    title: section.titleKey ? t(section.titleKey) : undefined,
    items: section.items.map((item) => ({
      label: t(item.labelKey),
      href: item.href,
      icon: item.icon,
      current: current?.id === item.screen,
    })),
  }))

  const home: Crumb = { label: t('screen.home'), href: '/' }
  const breadcrumbs = current?.id === 'SCR-010' ? [{ label: t('screen.home') }] : [home, ...crumbs]

  // Shell parts (SideNav, Breadcrumbs, brand, error-page actions) render plain
  // <a href>; route same-origin plain clicks through the router instead of a
  // full page load.
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!isPlainLeftClick(e)) return
    const a = (e.target as Element).closest('a')
    if (!a || a.target || a.hasAttribute('download')) return
    const href = a.getAttribute('href')
    if (!href || !href.startsWith('/') || href.startsWith('//')) return
    e.preventDefault()
    navigate(href)
  }

  return (
    // Delegates link activation only: links stay keyboard-operable (Enter
    // fires click on the <a>, which bubbles here).
    <div onClick={onClick}>
      <AppShell
        nav={nav}
        brand={
          <>
            <BrandMark variant="reversed" className="hidden h-9 w-auto tablet:block" />
            <BrandMark variant="reversed" lockup="mark" className="h-9 w-auto tablet:hidden" />
          </>
        }
        navLabel={t('shell.navLabel')}
        navCollapseLabel={t('shell.navCollapse')}
        navExpandLabel={t('shell.navExpand')}
        mainLabel={t('a11y.mainContent')}
        skipLinkLabel={t('a11y.skipToMain')}
        breadcrumbs={breadcrumbs}
        search={canAccess(role, 'SCR-041') ? <GlobalSearch inputId={GLOBAL_SEARCH_ID} /> : undefined}
        contextBar={contextBar}
        trailing={
          // Below tablet the bar holds only icon-sized controls; "Viewing as"
          // moves into the account menu so nothing overflows at ~400px.
          <>
            <LanguageSwitcher />
            {isTabletUp && <RoleSwitcher />}
            <ThemeToggle />
            <NotificationBell />
            <AppUserMenu roleSwitcher={isTabletUp ? undefined : <RoleSwitcher variant="menu" />} />
          </>
        }
        sampleDataBanner={
          API_MOCK ? (
            <Alert tone="warning" live={false}>
              {t('shell.sampleData')}
            </Alert>
          ) : undefined
        }
      >
        {children}
      </AppShell>
    </div>
  )
}
