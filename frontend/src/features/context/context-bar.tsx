import { decodeViewState, encodeViewState, type SavedViewScreen, type ViewParam, type ViewState } from '@lanewise/shared'
import { useEffect, useId, useMemo, useRef } from 'react'
import type { ContextOptions } from '@/api'
import { useRouter } from '@/app/router'
import { useAnnouncer } from '@/components/a11y'
import { Cluster } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/i18n'
import { clearDependents, resolveView, SCREEN_CONTEXT, type ContextField } from './context-view'
import { SavedViewsDialog } from './saved-views-dialog'
import { useContextOptions, useSavedViews } from './use-context-data'

/**
 * The planning context bar (wireframes/_build.py `ctx()`; design.md › Search
 * and filter; requirement 21.2–21.5): Scenario · Region · Format · Store ·
 * Department · Date or Season, only the filters that apply to the screen,
 * narrowing left to right, plus Saved views.
 *
 * The URL is the state (P8): every change replaces the query string with the
 * canonical view, so the address can be shared or bookmarked, and a loaded
 * URL is resolved against the loader's own (server-scoped) options — anything
 * outside their scope is dropped and the URL corrected. With no filters in
 * the URL, the user's default saved view for the screen is applied once.
 */
export function ContextBar({ screen }: { screen: SavedViewScreen }) {
  const { t } = useI18n()
  const { location, navigate } = useRouter()
  const { announce } = useAnnouncer()
  const fields = SCREEN_CONTEXT[screen]
  const options = useContextOptions()
  const views = useSavedViews(screen)

  const raw = useMemo(() => decodeViewState(location.search), [location.search])
  const resolved = useMemo(
    () => (options.data ? resolveView(fields, options.data, raw) : null),
    [fields, options.data, raw],
  )
  const state = resolved?.state ?? raw
  const query = encodeViewState(state)

  const goTo = (next: ViewState, replace = true) => {
    const q = encodeViewState(next)
    navigate(`${location.pathname}${q ? `?${q}` : ''}`, { replace })
  }

  // Keep the URL canonical and inside the loader's scope.
  useEffect(() => {
    if (!resolved) return
    const q = encodeViewState(resolved.state)
    if (location.search.replace(/^\?/, '') !== q) navigate(`${location.pathname}${q ? `?${q}` : ''}`, { replace: true })
  }, [resolved, location.pathname, location.search, navigate])

  // The screen's default view, once per visit, when the URL carries no filters.
  const defaultChecked = useRef(false)
  useEffect(() => {
    if (defaultChecked.current || !views.data) return
    defaultChecked.current = true
    if (encodeViewState(raw) !== '') return
    const preferred = views.data.find((v) => v.isDefault)
    if (preferred && preferred.query) {
      navigate(`${location.pathname}?${preferred.query}`, { replace: true })
      announce(t('savedViews.appliedDefault', { name: preferred.name }))
    }
  }, [views.data, raw, location.pathname, navigate, announce, t])

  const set = (param: ViewParam, value: string) => {
    const next = clearDependents({ ...state, [param]: value || undefined }, param)
    if (!value) delete next[param]
    goTo(next)
  }

  const hasFilters = fields.some((f) => state[f] !== undefined)

  return (
    <div role="group" aria-label={t('context.label')} className="border-2 border-outline bg-surface p-3">
      <Cluster gap={3} align="end">
        {options.loading ? (
          <>
            <Skeleton className="h-10 w-64" />
            <span className="sr-only">{t('context.loading')}</span>
          </>
        ) : options.error || !options.data || !resolved ? (
          <p role="alert" className="text-body text-danger">
            {t('context.error')}{' '}
            <Button variant="secondary" size="sm" onClick={options.reload}>
              {t('action.retry')}
            </Button>
          </p>
        ) : (
          fields.map((field) => (
            <ContextSelect
              key={field}
              field={field}
              value={state[field] ?? ''}
              allowed={resolved.allowed[field] ?? []}
              options={options.data as ContextOptions}
              onChange={(v) => set(field, v)}
            />
          ))
        )}
        <Cluster gap={2} className="ml-auto">
          {hasFilters && (
            <Button variant="ghost" onClick={() => goTo({ ...(state.sort ? { sort: state.sort } : {}) })}>
              {t('context.clear')}
            </Button>
          )}
          <SavedViewsDialog query={query} views={views} />
        </Cluster>
      </Cluster>
    </div>
  )
}

function ContextSelect({
  field,
  value,
  allowed,
  options,
  onChange,
}: {
  field: ContextField
  value: string
  allowed: readonly string[]
  options: ContextOptions
  onChange: (value: string) => void
}) {
  const { t, formatDate } = useI18n()
  const id = useId()
  const label = t(`context.${field}`)

  if (field === 'date') {
    return (
      <div className="flex min-w-40 flex-col gap-1">
        <label htmlFor={id} className="text-label text-text">
          {label}
        </label>
        <Input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    )
  }

  const labelFor = (optionId: string): string => {
    switch (field) {
      case 'scenario': {
        const s = options.scenarios.find((x) => x.id === optionId)
        if (!s) return optionId
        return t(s.stale ? 'context.scenarioOptionStale' : 'context.scenarioOption', {
          name: s.name,
          status: t(`scenario.status.${s.status}`),
        })
      }
      case 'region':
        return options.regions.find((r) => r.id === optionId)?.name ?? optionId
      case 'format':
        return t(`format.${optionId}`)
      case 'store':
        return options.stores.find((s) => s.id === optionId)?.name ?? optionId
      case 'dept':
        return options.departments.find((d) => d.id === optionId)?.name ?? optionId
      case 'season': {
        const s = options.seasons.find((x) => x.id === optionId)
        const fmt: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone: 'UTC' }
        return s ? t('context.seasonOption', { start: formatDate(s.start, fmt), end: formatDate(s.end, fmt) }) : optionId
      }
    }
  }

  return (
    <div className="flex min-w-48 flex-col gap-1">
      <label htmlFor={id} className="text-label text-text">
        {label}
      </label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t(`context.all.${field}`)}</option>
        {allowed.map((optionId) => (
          <option key={optionId} value={optionId}>
            {labelFor(optionId)}
          </option>
        ))}
      </Select>
    </div>
  )
}
