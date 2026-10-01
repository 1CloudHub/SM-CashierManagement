import { useCallback, useEffect, useMemo, useState } from 'react'
import { Star } from 'lucide-react'
import { can, type RoleCode, type ScenarioListItem, type ScenarioStatus, SCENARIO_STATUSES } from '@lanewise/shared'
import { Cluster, Stack } from '@/components/layout'
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
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableRowHeader,
  TableSkeleton,
  TableWrap,
} from '@/components/ui'
import { useDocumentTitle } from '@/features/auth/use-document-title'
import { useI18n } from '@/i18n'
import { errorCode, errorReference, type ScenarioListQuery, type ScenariosClient } from './api'
import { CALENDAR_DATE, DATE_TIME, SCENARIO_STATUS_TONE, seasonsOf } from './logic'

export interface ScenarioListScreenProps {
  readonly client: ScenariosClient
  readonly role: RoleCode | null
  readonly filters: Required<ScenarioListQuery>
  readonly onFiltersChange: (filters: Required<ScenarioListQuery>) => void
  readonly onOpen: (id: string) => void
  readonly onCompare: (id: string) => void
}

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly referenceId?: string }
  | { readonly kind: 'ready'; readonly scenarios: readonly ScenarioListItem[] }

/**
 * SCR-030 Scenario list (requirement 8): search, status/season/stale
 * filters, the ★ published scenario, stale pills and row actions. Planners
 * create, duplicate, submit and archive; other roles view (Store Managers see
 * the published plan only — the API filters).
 */
export function ScenarioListScreen({ client, role, filters, onFiltersChange, onOpen, onCompare }: ScenarioListScreenProps) {
  const { t, formatDate, formatDateTime } = useI18n()
  useDocumentTitle(t('scenarios.list.pageTitle'))
  const canView = can(role, 'scenarios', 'view')
  const canEdit = can(role, 'scenario_settings', 'edit')
  const canSubmit = can(role, 'scenario_submit', 'edit')
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [seasons, setSeasons] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const { status, season, stale, q } = filters

  const fetchList = useCallback(() => {
    client.list({ status, season, stale, q }).then(
      (scenarios) => {
        setLoad({ kind: 'ready', scenarios })
        setSeasons((prev) => [...new Set([...prev, ...seasonsOf(scenarios)])].sort())
      },
      (error: unknown) => setLoad({ kind: 'error', referenceId: errorReference(error) }),
    )
  }, [client, status, season, stale, q])

  useEffect(() => {
    if (canView) fetchList()
  }, [canView, fetchList])

  const act = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn()
      setNotice({ tone: 'success', text: success })
      fetchList()
    } catch (e) {
      setNotice({ tone: 'danger', text: t(errorCode(e) === 'conflict' ? 'scenarios.error.conflict' : 'scenarios.error.generic') })
    }
  }

  const statusOptions = useMemo(() => SCENARIO_STATUSES as readonly ScenarioStatus[], [])

  if (!canView) {
    return (
      <StateBlock
        variant="no-access"
        title={t('scenarios.list.noAccess.title')}
        description={t('scenarios.list.noAccess.description')}
      />
    )
  }

  const set = (patch: Partial<Required<ScenarioListQuery>>) => onFiltersChange({ ...filters, ...patch })

  return (
    <Stack gap={6}>
      <Cluster gap={4} justify="between">
        <h1 className="text-h1 text-text">{t('scenarios.list.title')}</h1>
        {canEdit && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            {`+ ${t('scenarios.list.new')}`}
          </Button>
        )}
      </Cluster>

      <Cluster gap={4} align="end">
        <Field label={t('scenarios.list.search')}>
          {(aria) => <Input {...aria} type="search" value={q} onChange={(e) => set({ q: e.target.value })} />}
        </Field>
        <Field label={t('scenarios.list.status')}>
          {(aria) => (
            <Select {...aria} value={status} onChange={(e) => set({ status: e.target.value as ScenarioStatus | '' })}>
              <option value="">{t('scenarios.list.status.all')}</option>
              {statusOptions.map((s) => (
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
        <Cluster gap={2} align="center" className="min-h-tap">
          <input
            id="scenarios-stale-only"
            type="checkbox"
            className="size-5 accent-primary"
            checked={stale}
            onChange={(e) => set({ stale: e.target.checked })}
          />
          <Label htmlFor="scenarios-stale-only">{t('scenarios.list.staleOnly')}</Label>
        </Cluster>
      </Cluster>

      {notice && <Alert tone={notice.tone} title={notice.text} />}

      {load.kind === 'loading' && <TableSkeleton columns={7} rows={4} label={t('state.loading')} />}

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

      {load.kind === 'ready' && (
        <TableWrap>
          <Table stickyFirstCol>
            <caption className="sr-only">{t('scenarios.list.caption')}</caption>
            <TableHead>
              <tr>
                <TableHeaderCell>{t('scenarios.list.col.name')}</TableHeaderCell>
                <TableHeaderCell>{t('scenarios.list.col.status')}</TableHeaderCell>
                <TableHeaderCell>{t('scenarios.list.col.season')}</TableHeaderCell>
                <TableHeaderCell>{t('scenarios.list.col.dataAsOf')}</TableHeaderCell>
                <TableHeaderCell>{t('scenarios.list.col.owner')}</TableHeaderCell>
                <TableHeaderCell>{t('scenarios.list.col.updated')}</TableHeaderCell>
                <TableHeaderCell>{t('scenarios.list.col.actions')}</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {load.scenarios.length === 0 && (
                <TableEmpty colSpan={7}>
                  <strong className="block text-text">{t('scenarios.list.empty.title')}</strong>
                  {t('scenarios.list.empty.description')}
                </TableEmpty>
              )}
              {load.scenarios.map((s) => {
                const draft = s.status === 'draft'
                const submittable = canSubmit && draft && !s.stale && s.lastRunAt !== null
                return (
                  <TableRow key={s.id}>
                    <TableRowHeader>
                      <Cluster gap={1} align="center">
                        {s.isPublished && (
                          <Star aria-label={t('scenarios.published')} role="img" className="size-4 shrink-0 fill-current" />
                        )}
                        <a
                          href={`/scenarios/${encodeURIComponent(s.id)}/settings`}
                          className="text-primary underline"
                          onClick={(e) => {
                            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                            e.preventDefault()
                            onOpen(s.id)
                          }}
                        >
                          {s.name}
                        </a>
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
                    <TableCell>{s.dataAsOf ? formatDateTime(s.dataAsOf, DATE_TIME) : t('scenarios.none')}</TableCell>
                    <TableCell>{s.ownerName}</TableCell>
                    <TableCell>{formatDateTime(s.updatedAt, DATE_TIME)}</TableCell>
                    <TableCell>
                      <Cluster gap={2}>
                        <Button size="sm" aria-label={`${t('scenarios.list.open')}: ${s.name}`} onClick={() => onOpen(s.id)}>
                          {t('scenarios.list.open')}
                        </Button>
                        {canEdit && (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`${t('scenarios.list.duplicate')}: ${s.name}`}
                            onClick={() =>
                              void act(async () => {
                                const d = await client.duplicate(s.id)
                                return d
                              }, t('scenarios.list.duplicated', { name: `${s.name}` }))
                            }
                          >
                            {t('scenarios.list.duplicate')}
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" aria-label={`${t('scenarios.list.compare')}: ${s.name}`} onClick={() => onCompare(s.id)}>
                          {t('scenarios.list.compare')}
                        </Button>
                        {submittable && (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`${t('scenarios.list.submit')}: ${s.name}`}
                            onClick={() => void act(() => client.submit(s.id), t('scenarios.list.submitted', { name: s.name }))}
                          >
                            {t('scenarios.list.submit')}
                          </Button>
                        )}
                        {canEdit && draft && (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`${t('scenarios.list.archive')}: ${s.name}`}
                            onClick={() => void act(() => client.archive(s.id), t('scenarios.list.archived', { name: s.name }))}
                          >
                            {t('scenarios.list.archive')}
                          </Button>
                        )}
                      </Cluster>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableWrap>
      )}

      <NewScenarioDialog
        key={creating ? 'open' : 'closed'}
        open={creating}
        client={client}
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
  defaultSeason,
  onClose,
  onCreated,
}: {
  open: boolean
  client: ScenariosClient
  defaultSeason: string
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [season, setSeason] = useState(defaultSeason)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        <DialogHeader>
          <DialogTitle>{t('scenarios.new.title')}</DialogTitle>
          <DialogDescription>{t('scenarios.new.description')}</DialogDescription>
        </DialogHeader>
        <Stack gap={4}>
          <Field label={t('scenarios.new.name')} required error={error && !name.trim() ? error : undefined}>
            {(aria) => <Input {...aria} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label={t('scenarios.new.season')} required error={error && !season.trim() ? error : undefined}>
            {(aria) => <Input {...aria} value={season} onChange={(e) => setSeason(e.target.value)} />}
          </Field>
          {error && name.trim() && season.trim() && <Alert tone="danger" title={error} />}
        </Stack>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void create()} aria-busy={busy || undefined} disabled={busy}>
            {t('scenarios.new.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
