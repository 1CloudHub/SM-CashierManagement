import { useEffect } from 'react'
import { useParams } from 'react-router'
import { ErrorPage, type ErrorKind, type RecoveryAction } from '@/components/errors'
import { ShortcutReference } from '@/components/help'
import { Section, Stack } from '@/components/layout'
import { Pill } from '@/components/ui/pill'
import { useDocumentTitle } from '@/features/auth/use-document-title'
import { ContextBar } from '@/features/context/context-bar'
import { isContextScreen } from '@/features/context/context-view'
import { useI18n } from '@/i18n'
import { canAccess } from './access'
import { useActiveRole } from './active-role'
import { AppLayout } from './app-layout'
import { useRouter } from './router'
import { useScreenCrumbs } from './screen-crumbs'
import { SCREEN_BY_ID, type ScreenDef } from './screens'

/**
 * Screen frames for the route table (./app-routes): the role guard, the
 * placeholder used until each feature task lands, and the No access / Not
 * found / status / help pages (SCR-090, SCR-091).
 *
 * The error/status screens have exactly one h1: the ErrorPage title (rendered
 * at heading level 1), so the screen does not add a second heading naming the
 * same state. The shell's document title and breadcrumb still name the screen.
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

/**
 * Recovery handlers for ErrorPage: Retry reloads, Back goes to the previous
 * screen, and the navigation actions route client-side.
 */
function useRecoveryAction(): (action: RecoveryAction) => void {
  const { navigate } = useRouter()
  return (action) => {
    switch (action) {
      case 'retry':
        window.location.reload()
        return
      case 'back':
        window.history.back()
        return
      case 'home':
        navigate('/')
        return
      case 'search':
        navigate('/search')
        return
      case 'signIn':
        navigate('/sign-in')
        return
    }
  }
}

export function NoAccessScreen() {
  const { t, locale } = useI18n()
  const onAction = useRecoveryAction()
  const title = t('screen.noAccess')
  return (
    <AppLayout title={title} crumbs={[{ label: title }]}>
      <ErrorPage kind="403" locale={locale} headingLevel={1} onAction={onAction} />
    </AppLayout>
  )
}

export function NotFoundScreen() {
  const { t, locale } = useI18n()
  const onAction = useRecoveryAction()
  const title = t('screen.notFound')
  return (
    <AppLayout title={title} crumbs={[{ label: title }]}>
      <ErrorPage kind="404" locale={locale} headingLevel={1} onAction={onAction} />
    </AppLayout>
  )
}

/**
 * A screen from the map that its feature task hasn't built yet. Planning
 * screens already get their context bar (task 20), so filters, the URL
 * state and saved views work before the screen body lands. The spec task and
 * screen id are a developer aid, shown only in development builds.
 */
export function PlaceholderScreen({ screen }: { screen: ScreenDef }) {
  const { t } = useI18n()
  const crumbs = useScreenCrumbs(screen)
  const title = t(screen.titleKey)
  const contextBar = isContextScreen(screen.id) ? <ContextBar screen={screen.id} /> : undefined
  const devPill = import.meta.env.DEV ? (
    <Pill>{screen.task ? t('placeholder.devTask', { task: screen.task, screen: screen.id }) : screen.id}</Pill>
  ) : undefined
  return (
    <AppLayout title={title} crumbs={crumbs} contextBar={contextBar}>
      <Stack gap={4}>
        <h1 className="text-h1 text-text">{title}</h1>
        <Section title={t('placeholder.title')} actions={devPill} description={t('placeholder.description')} />
      </Stack>
    </AppLayout>
  )
}

const ERROR_KINDS: readonly ErrorKind[] = ['400', '401', '403', '404', '429', '500', '503', 'offline']

/**
 * SCR-090: any status page by kind (`/status/403`; `/status` redirects to
 * `/status/404`). Inside the shell, except 401, which is a pre-auth state and
 * renders `bare` (no shell).
 */
export function StatusScreen() {
  const { kind } = useParams()
  const { t, locale } = useI18n()
  const onAction = useRecoveryAction()
  const screen = SCREEN_BY_ID['SCR-090']
  const crumbs = useScreenCrumbs(screen)
  const known = ERROR_KINDS.find((k) => k === kind)
  if (!known) return <NotFoundScreen />
  const title = t(screen.titleKey)
  if (known === '401') return <BareStatus title={title} kind={known} onAction={onAction} />
  return (
    <AppLayout title={title} crumbs={crumbs}>
      <ErrorPage kind={known} locale={locale} headingLevel={1} onAction={onAction} />
    </AppLayout>
  )
}

function BareStatus({
  title,
  kind,
  onAction,
}: {
  title: string
  kind: ErrorKind
  onAction: (action: RecoveryAction) => void
}) {
  const { t, locale } = useI18n()
  useDocumentTitle(t('shell.pageTitle', { title }))
  return <ErrorPage kind={kind} locale={locale} layout="bare" onAction={onAction} />
}

/** Help topics, in page order; each id is a reachable anchor (`/help#methodology`). */
const HELP_TOPICS = [
  { id: 'quick-start', titleKey: 'help.quickStart.title' },
  { id: 'how-it-works', titleKey: 'help.guideHeading' },
  { id: 'methodology', titleKey: 'help.links.methodology' },
  { id: 'matching', titleKey: 'help.matching.title' },
  { id: 'approvals', titleKey: 'help.approvals.title' },
  { id: 'shortcuts', titleKey: 'help.shortcutsHeading' },
  { id: 'support', titleKey: 'help.links.support' },
] as const

const METHODOLOGY_STEPS = ['forecast', 'lanes', 'shrinkage', 'roster', 'hiring'] as const
const MATCHING_ORDER = ['travel', 'headroom', 'fairness', 'cost'] as const
const APPROVAL_STEPS = ['headcount', 'budget', 'plan'] as const

/**
 * SCR-091 (wireframes/scr-091-help.html): quick start for the active role, the
 * "How it works" guide, the methodology, cross-store matching ranking, the
 * approval sequence, the shortcut reference and support. The `?` dialog links
 * here (`/help#methodology`, `/help#support`). Copy follows design.md
 * (Cross-store matching, Scenario and approval lifecycle) and DOM-001.
 */
export function HelpScreen() {
  const { t } = useI18n()
  const { role } = useActiveRole()
  const { location } = useRouter()
  const screen = SCREEN_BY_ID['SCR-091']
  const crumbs = useScreenCrumbs(screen)
  const title = t(screen.titleKey)
  const contextBar = isContextScreen(screen.id) ? <ContextBar screen={screen.id} /> : undefined

  // Deep links (`/help#support`) arrive via client-side navigation or a full
  // load after the content renders, so the browser's own anchor jump may not
  // happen: scroll the target section into view once it exists.
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1))
    if (!id) return
    const raf = requestAnimationFrame(() => {
      const target = document.getElementById(id)
      if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'start' })
    })
    return () => cancelAnimationFrame(raf)
  }, [location.hash])

  return (
    <AppLayout title={title} crumbs={crumbs} contextBar={contextBar}>
      <Stack gap={4}>
        <h1 className="text-h1 text-text">{title}</h1>

        <nav aria-label={t('help.topics.label')}>
          <ul className="flex flex-col gap-1 text-body">
            {HELP_TOPICS.map((topic) => (
              <li key={topic.id}>
                <a href={`#${topic.id}`} className="underline focus-visible:outline-focus-ring">
                  {t(topic.titleKey)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <Section id="quick-start" title={t('help.quickStart.title')} description={t(`role.${role}`)}>
          <p className="max-w-prose text-body text-text">{t(`help.quickStart.${role}`)}</p>
        </Section>

        <Section id="how-it-works" title={t('help.guideHeading')}>
          <p className="max-w-prose text-body text-text">{t('help.guide.body')}</p>
        </Section>

        <Section id="methodology" title={t('help.links.methodology')}>
          <p className="max-w-prose text-body text-text">{t('help.methodology.intro')}</p>
          <ol className="flex max-w-prose list-decimal flex-col gap-2 pl-6 text-body text-text">
            {METHODOLOGY_STEPS.map((step) => (
              <li key={step}>{t(`help.methodology.${step}`)}</li>
            ))}
          </ol>
        </Section>

        <Section id="matching" title={t('help.matching.title')}>
          <p className="max-w-prose text-body text-text">{t('help.matching.intro')}</p>
          <ol className="flex max-w-prose list-decimal flex-col gap-2 pl-6 text-body text-text">
            {MATCHING_ORDER.map((step) => (
              <li key={step}>{t(`help.matching.${step}`)}</li>
            ))}
          </ol>
          <p className="max-w-prose text-body-sm text-text-muted">{t('help.matching.privacy')}</p>
        </Section>

        <Section id="approvals" title={t('help.approvals.title')}>
          <p className="max-w-prose text-body text-text">{t('help.approvals.intro')}</p>
          <ol className="flex max-w-prose list-decimal flex-col gap-2 pl-6 text-body text-text">
            {APPROVAL_STEPS.map((step) => (
              <li key={step}>{t(`help.approvals.${step}`)}</li>
            ))}
          </ol>
          <p className="max-w-prose text-body text-text">{t('help.approvals.order')}</p>
          <p className="max-w-prose text-body text-text">{t('help.approvals.changes')}</p>
        </Section>

        {/* Not a Section: ShortcutReference is itself a region named
            "Keyboard shortcuts", and two same-named landmarks would clash. */}
        <Stack id="shortcuts" gap={4} className="border border-outline bg-surface p-4">
          <h2 className="text-h3 text-text">{t('help.shortcutsHeading')}</h2>
          <ShortcutReference />
        </Stack>

        <Section id="support" title={t('help.links.support')}>
          <p className="max-w-prose text-body text-text">{t('help.support.body')}</p>
        </Section>
      </Stack>
    </AppLayout>
  )
}
