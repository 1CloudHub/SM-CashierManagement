import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Star } from 'lucide-react'
import { can, SCENARIO_STATUSES, type RoleCode, type ScenarioListItem, type ScenarioStatus } from '@lanewise/shared'
import { canAccess } from '@/app/access'
import { isPlainLeftClick } from '@/app/links'
import { Cluster, Stack } from '@/components/layout'
import { useMediaQuery } from '@/components/layout/use-media-query'
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Label,
  Select,
  StateBlock,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableRowHeader,
  TableSkeleton,
  TableWrap,
} from '@/components/ui'
import { useDocumentTitle } from '@/features/auth/use-document-title'
import { useI18n } from '@/i18n'
import { errorCode, errorReference, type ScenariosClient } from './api'
import {
  CALENDAR_DATE,
  DATE_ONLY,
  DATE_TIME,
  NO_FILTERS,
  SCENARIO_STATUS_TONE,
  blockerFromError,
  hasActiveFilters,
  listRowBlocker,
  scenarioHref,
  seasonsOf,
  type ListFilters,
} from './logic'

export interface ScenarioListScreenProps {
  readonly client: ScenariosClient
  readonly role: RoleCode | null
  readonly filters: ListFilters
  readonly onFiltersChange: (filters: ListFilters) => void
  /** Client-side navigation to an in-app path (scenario links). */
  readonly onNavigate: (path: string) => void
  /** Opens a scenario's settings (after create / recalculate). */
  readonly onOpen: (id: string) => void
  readonly onCompare: (id: string) => void
}

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly referenceId?: string }
  | { readonly kind: 'ready'; readonly scenarios: readonly ScenarioListItem[] }

type Notice = { readonly tone: 'success' | 'danger'; readonly text: string } | null

/** Search keystrokes settle for this long before the list is re-queried. */
export const SEARCH_DEBOUNCE_MS = 250

const ARCHIVABLE: readonly ScenarioStatus[] = ['draft', 'superseded']

/**
 * SCR-030 Scenario list (requirement 8): search (debounced), status /
 * season / owner / stale filters, the ★ published scenario, rules and data
 * dates, stale pills and row actions. Planners create, duplicate,
 * recalculate, submit (shown disabled with the reason when blocked) and
 * archive (with confirmation); other roles view (Store Managers see the
 * published plan only — the API filters). Read-only on a phone.
 */
export function ScenarioListScreen({ client, role, filters, onFiltersChange, onNavigate, onOpen, onCompare }: ScenarioListScreenProps) {
  const { t, formatDate, formatDateTime } = useI18n()
  useDocumentTitle(t('scenarios.list.pageTitle'))
  const ids = useId()
  const isTabletUp = useMediaQuery('(min-width: 37.5rem)')
  const canView = can(role, 'scenarios', 'view')
  const canEdit = can(role, 'scenario_settings', 'edit') && isTabletUp
  const canSubmit = can(role, 'scenario_submit', 'edit') && isTabletUp
  const canCompare = role !== null && canAccess(role, 'SCR-032')
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [seasons, setSeasons] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [archiving, setArchiving] = useState<ScenarioListItem | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [search, setSearch] = useState(filters.q)
  const { status, season, stale, q, owner } = filters
  const request = useRef<AbortController | null>(null)

  // Keep the box in step when the URL changes from elsewhere (back/forward, Clear filters).
  const [lastQ, setLastQ] = useState(q)
  if (q !== lastQ) {
    setLastQ(q)
    setSearch(q)
  }

  const fetchList = useCallback(() => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    client.list({ status, season, stale, q, owner }, { signal: controller.signal }).then(
      (scenarios) => {
        if (controller.signal.aborted) return
        setLoad({ kind: 'ready', scenarios })
        setSeasons((prev) => [...new Set([...prev, ...seasonsOf(scenarios)])].sort())
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setLoad({ kind: 'error', referenceId: errorReference(error) })
      },
    )
  }, [client, status, season, stale, q, owner])

  useEffect(() => {
    if (canView) fetchList()
  }, [canView, fetchList])

  useEffect(() => () => request.current?.abort(), [])

  const set = useCallback((patch: Partial<ListFilters>) => onFiltersChange({ ...filters, ...patch }), [filters, onFiltersChange])

  // Debounced search: the URL (and so the request) follows the box after a pause.
  useEffect(() => {
    if (search === q) return
    const timer = window.setTimeout(() => set({ q: search }), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [search, q, set])

  const act = async (id: string, fn: () => Promise<unknown>, success: string | null) => {
    setBusyId(id)
    setNotice(null)
    try {
      await fn()
      if (success) setNotice({ tone: 'success', text: success })
      fetchList()
    } catch (e) {
      const code = errorCode(e)
      const blocker = blockerFromError(code, e instanceof Error ? e.message : undefined)
      setNotice({
        tone: 'danger',
        text: t(blocker ? `scenarios.blocker.${blocker}` : code === 'conflict' ? 'scenarios.error.conflict' : 'scenarios.error.generic'),
      })
    } finally {
      setBusyId(null)
    }
  }

  if (!canView) {
    return <StateBlock variant="no-access" title={t('scenarios.list.noAccess.title')} description={t('scenarios.list.noAccess.description')} />
  }

  const filtered = hasActiveFilters(filters)
  const newButton = canEdit && (
    <Button variant="primary" onClick={() => setCreating(true)}>
      <span aria-hidden="true">+</span>
      {t('scenarios.list.new')}
    </Button>
  )

  return (
    <Stack gap={6}>
      {!isTabletUp && <Alert tone="info" live={false} title={t('scenarios.phone.readOnly')} />}

      <Cluster gap={4} justify="between">
        <h1 className="text-h1 text-text">{t('scenarios.list.title')}</h1>
        {newButton}
      </Cluster>

      <div role="search" aria-label={t('scenarios.list.filters')}>
        <Cluster gap={4} align="end">
          <Field label={t('scenarios.list.search')}>
            {(aria) => <Input {...aria} type="search" value={search} onChange={(e) => setSearch(e.target.value)} />}
          </Field>
          <Field label={t('scenarios.list.status')}>
            {(aria) => (
              <Select {...aria} value={status} onChange={(e) => set({ status: e.target.value as ScenarioStatus | '' })}>
                <option value="">{t('scenarios.list.status.all')}</option>
                {SCENARIO_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`scenario.status.${s}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('scenarios.list.season')}>
            {(aria) => (
              <Select {...aria} value={season} onChange={(e) => set({ season: e.target.value })}>
                <option value="">{t('scenarios.list.season.all')}</option>
                {seasons.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('scenarios.list.owner')}>
            {(aria) => (
              <Select {...aria} value={owner} onChange={(e) => set({ owner: e.target.value === 'me' ? 'me' : '' })}>
                <option value="">{t('scenarios.list.owner.anyone')}</option>
                <option value="me">{t('scenarios.list.owner.me')}</option>
              </Select>
            )}
          </Field>
          <Cluster gap={2} align="center" className="min-h-tap">
            <input
              id={`${ids}-stale`}
              type="checkbox"
              className="size-5 accent-primary"
              checked={stale}
              onChange={(e) => set({ stale: e.target.checked })}
            />
            <Label htmlFor={`${ids}-stale`}>{t('scenarios.list.staleOnly')}</Label>
          </Cluster>
        </Cluster>
      </div>

      {notice && <Alert tone={notice.tone} title={notice.text} assertive={notice.tone === 'danger'} />}

      {load.kind === 'loading' && <TableSkeleton columns={8} rows={4} label={t('state.loading')} />}

      {load.kind === 'error' && (
        <StateBlock
          variant="error"
          title={t('scenarios.list.error.title')}
          referenceId={load.referenceId}
          action={
            <Button
              onClick={() => {
                setLoad({ kind: 'loading' })
                fetchList()
              }}
            >
              {t('action.retry')}
            </Button>
          }
        />
      )}

      {load.kind === 'ready' && load.scenarios.length === 0 && filtered && (
        <StateBlock
          variant="empty"
          title={t('scenarios.list.noResults.title')}
          description={t('scenarios.list.noResults.description')}
          action={
            <Button
              onClick={() => {
                setSearch('')
                onFiltersChange(NO_FILTERS)
              }}
            >
              {t('scenarios.list.clearFilters')}
            </Button>
          }
        />
      )}

      {load.kind === 'ready' && load.scenarios.length === 0 && !filtered && (
        <StateBlock
          variant="empty"
          title={t('scenarios.list.empty.title')}
          description={t(canEdit ? 'scenarios.list.empty.description' : 'scenarios.list.empty.viewer')}
          action={newButton || undefined}
        />
      )}

      {load.kind === 'ready' && load.scenarios.length > 0 && (
        <TableWrap>
          <Table stickyFirstCol aria-busy={busyId !== null || undefined}>
            <caption className="sr-only">{t('scenarios.list.caption')}</caption>
            <TableHead>
              <tr>
                <TableHeaderCell>{t('scenarios.list.col.name')}</TableHeaderCell>
                <TableHeaderCell>{t('scenarios.list.col.status')}</TableHeaderCell>
                <TableHeaderCell>{t('scenarios.list.col.season')}</TableHeaderCell>
                <TableHeaderCell>{t('scenarios.list.col.rules')}</TableHeaderCell>
                <TableHeaderCell>{t('scenarios.list.col.dataAsOf')}</TableHeaderCell>
                <TableHeaderCell>{t('scenarios.list.col.owner')}</TableHeaderCell>
                <TableHeaderCell>{t('scenarios.list.col.updated')}</TableHeaderCell>
                <TableHeaderCell>{t('scenarios.list.col.actions')}</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {load.scenarios.map((s) => {
                const href = scenarioHref(role, s)
                const busy = busyId === s.id
                const blocker = listRowBlocker(s)
                const blockerId = `${ids}-${s.id}-blocker`
                return (
                  <TableRow key={s.id} aria-busy={busy || undefined}>
                    <TableRowHeader>
                      <Cluster gap={1} align="center">
                        {s.isPublished && <Star aria-label={t('scenarios.published')} role="img" className="size-4 shrink-0 fill-current" />}
                        {href ? (
                          <a
                            href={href}
                            className="text-primary underline"
                            onClick={(e) => {
                              if (!isPlainLeftClick(e)) return
                              e.preventDefault()
                              onNavigate(href)
                            }}
                          >
                            {s.name}
                          </a>
                        ) : (
                          s.name
                        )}
                      </Cluster>
                    </TableRowHeader>
                    <TableCell>
                      <Cluster gap={1}>
                        <StatusPill tone={SCENARIO_STATUS_TONE[s.status]}>{t(`scenario.status.${s.status}`)}</StatusPill>
                        {s.stale && <StatusPill tone="warning">{t('scenarios.stale')}</StatusPill>}
                      </Cluster>
                    </TableCell>
                    <TableCell>
                      {t('scenarios.season.range', {
                        from: formatDate(s.planningFrom, CALENDAR_DATE),
                        to: formatDate(s.planningTo, CALENDAR_DATE),
                      })}
                    </TableCell>
                    <TableCell>
                      {s.rulesAsOf ? t('scenarios.list.rulesPublished', { date: formatDate(s.rulesAsOf, DATE_ONLY) }) : t('scenarios.none')}
                    </TableCell>
                    <TableCell>{s.dataAsOf ? formatDate(s.dataAsOf, DATE_ONLY) : t('scenarios.none')}</TableCell>
                    <TableCell>{s.ownerName}</TableCell>
                    <TableCell>{formatDateTime(s.updatedAt, DATE_TIME)}</TableCell>
                    <TableCell>
                      <Stack gap={1}>
                        <Cluster gap={2}>
                          {canEdit && s.stale && (
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={busy}
                              aria-busy={busy || undefined}
                              aria-label={`${t('action.recalculate')}: ${s.name}`}
                              onClick={() =>
                                void act(
                                  s.id,
                                  async () => {
                                    if (s.status === 'draft') return client.run(s.id)
                                    const fresh = await client.refresh(s.id)
                                    onOpen(fresh.id)
                                    return fresh
                                  },
                                  s.status === 'draft' ? t('scenarios.list.recalculated', { name: s.name }) : null,
                                )
                              }
                            >
                              {t('action.recalculate')}
                            </Button>
                          )}
                          {canEdit && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              aria-label={`${t('scenarios.list.duplicate')}: ${s.name}`}
                              onClick={() => void act(s.id, () => client.duplicate(s.id), t('scenarios.list.duplicated', { name: s.name }))}
                            >
                              {t('scenarios.list.duplicate')}
                            </Button>
                          )}
                          {canCompare && (
                            <Button size="sm" variant="ghost" aria-label={`${t('scenarios.list.compare')}: ${s.name}`} onClick={() => onCompare(s.id)}>
                              {t('scenarios.list.compare')}
                            </Button>
                          )}
                          {canSubmit && s.status === 'draft' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy || blocker !== null}
                              aria-describedby={blocker ? blockerId : undefined}
                              aria-label={`${t('scenarios.list.submit')}: ${s.name}`}
                              onClick={() => void act(s.id, () => client.submit(s.id), t('scenarios.list.submitted', { name: s.name }))}
                            >
                              {t('scenarios.list.submit')}
                            </Button>
                          )}
                          {canEdit && ARCHIVABLE.includes(s.status) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              aria-label={`${t('scenarios.list.archive')}: ${s.name}`}
                              onClick={() => setArchiving(s)}
                            >
                              {t('scenarios.list.archive')}
                            </Button>
                          )}
                        </Cluster>
                        {canSubmit && s.status === 'draft' && blocker && (
                          <span id={blockerId} className="text-body-sm text-text-muted">
                            {t(`scenarios.blocker.${blocker}`)}
                          </span>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableWrap>
      )}

      <Dialog open={archiving !== null} onOpenChange={(open) => !open && setArchiving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('scenarios.archive.title', { name: archiving?.name ?? '' })}</DialogTitle>
            <DialogDescription>{t('scenarios.archive.description')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setArchiving(null)}>
              {t('action.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const target = archiving
                setArchiving(null)
                if (target) void act(target.id, () => client.archive(target.id), t('scenarios.list.archived', { name: target.name }))
              }}
            >
              {t('scenarios.archive.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewScenarioDialog
        key={creating ? 'open' : 'closed'}
        open={creating}
        client={client}
        seasons={seasons}
        defaultSeason={season || seasons[0] || ''}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false)
          onOpen(id)
        }}
      />
    </Stack>
  )
}

function NewScenarioDialog({
  open,
  client,
  seasons,
  defaultSeason,
  onClose,
  onCreated,
}: {
  open: boolean
  client: ScenariosClient
  seasons: readonly string[]
  defaultSeason: string
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [season, setSeason] = useState(defaultSeason)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const options = [...new Set([...seasons, ...(defaultSeason ? [defaultSeason] : [])])].sort()

  const create = async () => {
    if (!name.trim() || !season.trim()) {
      setError(t('scenarios.new.required'))
      return
    }
    setBusy(true)
    try {
      const scenario = await client.create({ name: name.trim(), season: season.trim() })
      onCreated(scenario.id)
    } catch {
      setError(t('scenarios.error.generic'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (!busy) void create()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('scenarios.new.title')}</DialogTitle>
            <DialogDescription>{t('scenarios.new.description')}</DialogDescription>
          </DialogHeader>
          <Stack gap={4}>
            <Field label={t('scenarios.new.name')} required error={error && !name.trim() ? error : undefined}>
              {(aria) => <Input {...aria} value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
            <Field label={t('scenarios.new.season')} required error={error && !season.trim() ? error : undefined}>
              {(aria) =>
                options.length > 0 ? (
                  <Select {...aria} value={season} onChange={(e) => setSeason(e.target.value)}>
                    {!season && <option value="">{t('scenarios.new.season.choose')}</option>}
                    {options.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input {...aria} value={season} onChange={(e) => setSeason(e.target.value)} />
                )
              }
            </Field>
            {error && name.trim() && season.trim() && <Alert tone="danger" title={error} />}
          </Stack>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('action.cancel')}
            </Button>
            <Button type="submit" variant="primary" aria-busy={busy || undefined} disabled={busy}>
              {t('scenarios.new.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
