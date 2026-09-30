import { SEARCH_PAGE_LIMIT } from '@lanewise/shared'
import { useActiveRole } from '@/app/active-role'
import { AppLayout } from '@/app/app-layout'
import { AppLink, useRouter } from '@/app/router'
import { useScreenCrumbs } from '@/app/screen-crumbs'
import { SCREEN_BY_ID } from '@/app/screens'
import { useAnnounce } from '@/components/a11y'
import { Section, Stack } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { CardSkeleton } from '@/components/ui/card'
import { StateBlock } from '@/components/ui/state-block'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useI18n } from '@/i18n'
import { displayGroups, type DisplayGroup, type DisplayGroupKey } from './search-groups'
import { useSearch } from './use-search'

/**
 * SCR-041 Search results (wireframes/scr-041-search.html; requirement 21.1).
 * `?q=` is the query and `?type=` the selected tab, so a results page can be
 * shared like any other view. Tabs: All plus one per group the role may
 * search; every hit is already inside the role's scope (P1, P11).
 */
export function SearchResultsScreen() {
  const { t } = useI18n()
  const { role } = useActiveRole()
  const { location, navigate } = useRouter()
  const screen = SCREEN_BY_ID['SCR-041']
  const crumbs = useScreenCrumbs(screen)
  const params = new URLSearchParams(location.search)
  const query = (params.get('q') ?? '').trim()
  const { data, error, loading, idle, retry } = useSearch(query, SEARCH_PAGE_LIMIT)
  const groups = data ? displayGroups(role, query, data, t, SEARCH_PAGE_LIMIT) : []
  const total = groups.reduce((n, g) => n + g.total, 0)
  const tabs: ('all' | DisplayGroupKey)[] = ['all', ...groups.map((g) => g.key)]
  const requested = params.get('type')
  const tab = tabs.find((k) => k === requested) ?? 'all'
  const title = query ? t('search.results.title', { query }) : t(screen.titleKey)
  useAnnounce(data ? t('search.tab.all', { count: total }) : undefined)

  const selectTab = (value: string) => {
    const next = new URLSearchParams({ q: query })
    if (value !== 'all') next.set('type', value)
    navigate(`/search?${next.toString()}`, { replace: true })
  }

  let body: React.ReactNode
  if (idle) {
    body = <StateBlock title={t('search.results.prompt.title')} description={t('search.results.prompt.description')} />
  } else if (loading) {
    body = (
      <Stack gap={4} aria-busy="true">
        <CardSkeleton label={t('state.loading')} />
        <CardSkeleton label={t('state.loading')} />
      </Stack>
    )
  } else if (error || !data) {
    body = (
      <StateBlock
        variant="error"
        title={t('search.results.error.title')}
        description={t('state.error.description')}
        action={<Button onClick={retry}>{t('action.retry')}</Button>}
      />
    )
  } else if (total === 0) {
    body = <StateBlock title={t('search.results.empty.title')} description={t('search.results.empty.description', { query })} />
  } else {
    body = (
      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList aria-label={t('search.tabs.label')}>
          <TabsTrigger value="all">{t('search.tab.all', { count: total })}</TabsTrigger>
          {groups.map((g) => (
            <TabsTrigger key={g.key} value={g.key}>
              {t('search.tab.group', { label: g.label, count: g.total })}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="all">
          <Stack gap={4}>
            {groups
              .filter((g) => g.total > 0)
              .map((g) => (
                <ResultGroup key={g.key} group={g} />
              ))}
          </Stack>
        </TabsContent>
        {groups.map((g) => (
          <TabsContent key={g.key} value={g.key}>
            {g.total > 0 ? (
              <ResultGroup group={g} />
            ) : (
              <StateBlock title={t('search.results.empty.title')} description={t('search.results.empty.description', { query })} />
            )}
          </TabsContent>
        ))}
      </Tabs>
    )
  }

  return (
    <AppLayout title={title} crumbs={crumbs}>
      <Stack gap={4}>
        <h1 className="text-h1 text-text">{title}</h1>
        {body}
        {data && <p className="text-body-sm text-text-muted">{t('search.results.scopeNote')}</p>}
      </Stack>
    </AppLayout>
  )
}

function ResultGroup({ group }: { group: DisplayGroup }) {
  const { t } = useI18n()
  return (
    <Section title={group.label}>
      <ul className="flex flex-col gap-2">
        {group.hits.map((h) => (
          <li key={h.id} className="flex flex-col">
            {h.href ? (
              <AppLink href={h.href} className="text-body text-text underline focus-visible:outline-focus-ring">
                {h.label}
              </AppLink>
            ) : (
              <span className="text-body text-text">{h.label}</span>
            )}
            {h.detail && <span className="text-body-sm text-text-muted">{h.detail}</span>}
          </li>
        ))}
      </ul>
      {group.total > group.hits.length && (
        <p className="text-body-sm text-text-muted">{t('search.results.more', { shown: group.hits.length, total: group.total })}</p>
      )}
    </Section>
  )
}
