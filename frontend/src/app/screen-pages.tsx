import { useParams } from 'react-router'
import { ErrorPage, type ErrorKind } from '@/components/errors'
import { ShortcutReference } from '@/components/help'
import { Section, Stack } from '@/components/layout'
import { Pill } from '@/components/ui/pill'
import { ContextBar } from '@/features/context/context-bar'
import { isContextScreen } from '@/features/context/context-view'
import { useI18n } from '@/i18n'
import { canAccess } from './access'
import { useActiveRole } from './active-role'
import { AppLayout } from './app-layout'
import { useScreenCrumbs } from './screen-crumbs'
import { SCREEN_BY_ID, type ScreenDef } from './screens'

/**
 * Screen frames for the route table (./app-routes): the role guard, the
 * placeholder used until each feature task lands, and the No access / Not
 * found / status / help pages (SCR-090, SCR-091).
 */

/**
 * Renders `children` only when the active role may open `screen`; otherwise
 * the No access state (requirement 2.4). The guard decides before any screen
 * content mounts, so an out-of-scope deep link never fetches or shows the
 * object — the breadcrumb and title name only the generic state.
 */
export function Guarded({ screen, children }: { screen: ScreenDef; children: React.ReactNode }) {
  const { role } = useActiveRole()
  if (!canAccess(role, screen)) return <NoAccessScreen />
  return <>{children}</>
}

export function NoAccessScreen() {
  const { t, locale } = useI18n()
  const title = t('screen.noAccess')
  return (
    <AppLayout title={title} crumbs={[{ label: title }]}>
      <h1 className="text-h1 text-text">{title}</h1>
      <ErrorPage kind="403" locale={locale} />
    </AppLayout>
  )
}

export function NotFoundScreen() {
  const { t, locale } = useI18n()
  const title = t('screen.notFound')
  return (
    <AppLayout title={title} crumbs={[{ label: title }]}>
      <h1 className="text-h1 text-text">{title}</h1>
      <ErrorPage kind="404" locale={locale} />
    </AppLayout>
  )
}

/**
 * A screen from the map that its feature task hasn't built yet. Planning
 * screens already get their context bar (task 20), so filters, the URL
 * state and saved views work before the screen body lands.
 */
export function PlaceholderScreen({ screen }: { screen: ScreenDef }) {
  const { t } = useI18n()
  const crumbs = useScreenCrumbs(screen)
  const title = t(screen.titleKey)
  const task = screen.task ?? ''
  const contextBar = isContextScreen(screen.id) ? <ContextBar screen={screen.id} /> : undefined
  return (
    <AppLayout title={title} crumbs={crumbs} contextBar={contextBar}>
      <Stack gap={4}>
        <h1 className="text-h1 text-text">{title}</h1>
        <Section
          title={t('placeholder.title', { task })}
          actions={<Pill>{screen.id}</Pill>}
          description={t('placeholder.description', { task })}
        />
      </Stack>
    </AppLayout>
  )
}

const ERROR_KINDS: readonly ErrorKind[] = ['400', '401', '403', '404', '429', '500', '503', 'offline']

/** SCR-090: any status page by kind, inside the shell (`/status/403`). */
export function StatusScreen() {
  const { kind } = useParams()
  const { t, locale } = useI18n()
  const screen = SCREEN_BY_ID['SCR-090']
  const crumbs = useScreenCrumbs(screen)
  const known = ERROR_KINDS.find((k) => k === kind)
  if (!known) return <NotFoundScreen />
  const title = t(screen.titleKey)
  return (
    <AppLayout title={title} crumbs={crumbs}>
      <h1 className="text-h1 text-text">{title}</h1>
      <ErrorPage kind={known} locale={locale} />
    </AppLayout>
  )
}

/** SCR-091: the guide and the full shortcut reference (the `?` dialog shows the same). */
export function HelpScreen() {
  const { t } = useI18n()
  const screen = SCREEN_BY_ID['SCR-091']
  const crumbs = useScreenCrumbs(screen)
  const title = t(screen.titleKey)
  const contextBar = isContextScreen(screen.id) ? <ContextBar screen={screen.id} /> : undefined
  return (
    <AppLayout title={title} crumbs={crumbs} contextBar={contextBar}>
      <Stack gap={4}>
        <h1 className="text-h1 text-text">{title}</h1>
        <Section title={t('help.guideHeading')}>
          <p className="text-body text-text">{t('help.guide.body')}</p>
        </Section>
        <Section title={t('help.shortcutsHeading')}>
          <ShortcutReference />
        </Section>
      </Stack>
    </AppLayout>
  )
}
