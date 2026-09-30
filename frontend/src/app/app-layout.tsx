import { createContext, useContext, type MouseEvent, type ReactNode } from 'react'
import { AppShell } from '@/components/layout'
import type { NavSection } from '@/components/shell'
import { Alert } from '@/components/ui/alert'
import type { Crumb } from '@/components/ui/breadcrumbs'
import { useDocumentTitle } from '@/features/auth/use-document-title'
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
 * as" switcher, language, account menu, global search, breadcrumb, sample-data
 * banner and page title. Screens render inside it.
 */

export const GLOBAL_SEARCH_ID = 'global-search'

/** Slots the app root fills in (e.g. the account menu, which needs auth). */
export interface ShellSlots {
  readonly account?: ReactNode
}

const ShellSlotsContext = createContext<ShellSlots>({})
export const ShellSlotsProvider = ShellSlotsContext.Provider

export function useShellSlots(): ShellSlots {
  return useContext(ShellSlotsContext)
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
  const slots = useShellSlots()
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
        navLabel={t('shell.navLabel')}
        mainLabel={t('a11y.mainContent')}
        skipLinkLabel={t('a11y.skipToMain')}
        breadcrumbs={breadcrumbs}
        search={canAccess(role, 'SCR-041') ? <GlobalSearch inputId={GLOBAL_SEARCH_ID} /> : undefined}
        contextBar={contextBar}
        trailing={
          <>
            <LanguageSwitcher />
            <RoleSwitcher />
            {slots.account}
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
