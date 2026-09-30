import { useCallback, useEffect, useState } from 'react'
import {
  hasRulePermission,
  isIsoDate,
  type RoleCode,
  type RuleSetSummary,
} from '@lanewise/shared'
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
  Num,
  Pill,
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
import { useI18n } from '@/i18n'
import { useDocumentTitle } from '@/features/auth/use-document-title'
import type { RulesClient } from './api'
import { CALENDAR_DATE, STATUS_TONE, statusLabel } from './labels'

export interface RuleSetsScreenProps {
  readonly client: RulesClient
  /** The active role (demo role switcher, task 8.2); the API re-checks it. */
  readonly role: RoleCode | null
  /** Opens SCR-061 for a version. */
  readonly onOpenVersion: (versionId: string) => void
  /** Today's date (YYYY-MM-DD) as the default effective date of a new draft. */
  readonly today?: string
}

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly referenceId?: string }
  | { readonly kind: 'ready'; readonly ruleSets: readonly RuleSetSummary[] }

const todayIso = (): string => new Date().toISOString().slice(0, 10)

/**
 * SCR-060 Rule sets (requirement 16). Every rule set with its in-force
 * version, its open draft and how many scenarios use it. The Rules Steward
 * starts new drafts; Finance sees the cost rules waiting for approval.
 */
export function RuleSetsScreen({ client, role, onOpenVersion, today }: RuleSetsScreenProps) {
  const { t, formatDate } = useI18n()
  useDocumentTitle(t('rules.list.pageTitle'))
  const canView = hasRulePermission(role, 'rules.view')
  const canEdit = hasRulePermission(role, 'rules.edit')
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [draftFor, setDraftFor] = useState<RuleSetSummary | null>(null)

  const fetchSets = useCallback(() => {
    client.listRuleSets().then(
      (ruleSets) => setLoad({ kind: 'ready', ruleSets }),
      (error: unknown) =>
        setLoad({ kind: 'error', referenceId: (error as { requestId?: string | null }).requestId ?? undefined }),
    )
  }, [client])

  useEffect(() => {
    if (canView) fetchSets()
  }, [canView, fetchSets])

  const refresh = () => {
    setLoad({ kind: 'loading' })
    fetchSets()
  }

  if (!canView) {
    return (
      <StateBlock
        variant="no-access"
        title={t('rules.list.noAccess.title')}
        description={t('rules.list.noAccess.description')}
      />
    )
  }

  const awaiting =
    load.kind === 'ready' && hasRulePermission(role, 'rules.approve_cost')
      ? load.ruleSets.filter((s) => s.isCostRule && s.openVersion?.status === 'submitted')
      : []
  const firstAwaiting = awaiting[0]

  return (
    <Stack gap={6}>
      <h1 className="text-h1 text-text">{t('rules.list.title')}</h1>

      {firstAwaiting?.openVersion && (
        <Alert
          tone="info"
          title={t(awaiting.length === 1 ? 'rules.list.awaitingFinance' : 'rules.list.awaitingFinance.other', {
            count: awaiting.length,
          })}
          action={
            <Button size="sm" variant="primary" onClick={() => onOpenVersion(firstAwaiting.openVersion!.id)}>
              {t('rules.list.reviewNamed', { name: firstAwaiting.name, version: firstAwaiting.openVersion.version })}
            </Button>
          }
        />
      )}

      {load.kind === 'loading' && <TableSkeleton columns={7} rows={5} label={t('state.loading')} />}

      {load.kind === 'error' && (
        <StateBlock
          variant="error"
          title={t('rules.list.error.title')}
          referenceId={load.referenceId}
          action={<Button onClick={refresh}>{t('action.retry')}</Button>}
        />
      )}

      {load.kind === 'ready' && (
        <TableWrap>
          <Table stickyFirstCol>
            <caption className="sr-only">{t('rules.list.caption')}</caption>
            <TableHead>
              <tr>
                <TableHeaderCell>{t('rules.list.col.ruleSet')}</TableHeaderCell>
                <TableHeaderCell>{t('rules.list.col.costRule')}</TableHeaderCell>
                <TableHeaderCell>{t('rules.list.col.current')}</TableHeaderCell>
                <TableHeaderCell>{t('rules.list.col.effective')}</TableHeaderCell>
                <TableHeaderCell>{t('rules.list.col.draft')}</TableHeaderCell>
                <TableHeaderCell numeric>{t('rules.list.col.usedBy')}</TableHeaderCell>
                <TableHeaderCell>{t('rules.list.col.actions')}</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {load.ruleSets.length === 0 && (
                <TableEmpty colSpan={7}>
                  <strong className="block text-text">{t('rules.list.empty.title')}</strong>
                  {t('rules.list.empty.description')}
                </TableEmpty>
              )}
              {load.ruleSets.map((set) => {
                const open = set.openVersion
                const current = set.currentVersion
                const review = open && open.status === 'submitted' && set.isCostRule && hasRulePermission(role, 'rules.approve_cost')
                return (
                  <TableRow key={set.id}>
                    <TableRowHeader>{set.name}</TableRowHeader>
                    <TableCell>
                      {set.isCostRule ? <Pill>{t('rules.list.yes')}</Pill> : t('rules.list.no')}
                    </TableCell>
                    <TableCell>
                      {current ? t('rules.list.versionLabel', { version: current.version }) : t('rules.list.none')}
                    </TableCell>
                    <TableCell>{current ? formatDate(current.effectiveFrom, CALENDAR_DATE) : t('rules.list.none')}</TableCell>
                    <TableCell>
                      {open ? (
                        <Cluster gap={2}>
                          <span>{t('rules.list.versionLabel', { version: open.version })}</span>
                          <StatusPill tone={STATUS_TONE[open.status]}>{statusLabel(t, open.status)}</StatusPill>
                        </Cluster>
                      ) : (
                        t('rules.list.none')
                      )}
                    </TableCell>
                    <TableCell numeric>
                      <Num value={set.scenarioCount} />
                    </TableCell>
                    <TableCell>
                      <Cluster gap={2}>
                        {open && (
                          <Button
                            size="sm"
                            variant={review ? 'primary' : 'secondary'}
                            aria-label={`${review ? t('rules.list.review') : t('rules.list.openDraft')}: ${set.name}`}
                            onClick={() => onOpenVersion(open.id)}
                          >
                            {review ? t('rules.list.review') : t('rules.list.openDraft')}
                          </Button>
                        )}
                        {!open && canEdit && (
                          <Button
                            size="sm"
                            aria-label={`${t('rules.list.newDraft')}: ${set.name}`}
                            onClick={() => setDraftFor(set)}
                          >
                            {t('rules.list.newDraft')}
                          </Button>
                        )}
                        {current && (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`${t('rules.list.view')}: ${set.name} ${t('rules.list.versionLabel', { version: current.version })}`}
                            onClick={() => onOpenVersion(current.id)}
                          >
                            {t('rules.list.view')}
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

      <p className="text-body-sm text-text-muted">{t('rules.list.note')}</p>

      <NewDraftDialog
        // Remount per rule set so the form starts fresh.
        key={draftFor?.id ?? 'none'}
        client={client}
        ruleSet={draftFor}
        defaultDate={today ?? todayIso()}
        onClose={() => setDraftFor(null)}
        onCreated={(id) => {
          setDraftFor(null)
          onOpenVersion(id)
        }}
      />
    </Stack>
  )
}

function NewDraftDialog({
  client,
  ruleSet,
  defaultDate,
  onClose,
  onCreated,
}: {
  client: RulesClient
  ruleSet: RuleSetSummary | null
  defaultDate: string
  onClose: () => void
  onCreated: (versionId: string) => void
}) {
  const { t } = useI18n()
  const [effectiveFrom, setEffectiveFrom] = useState(defaultDate)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    if (!ruleSet) return
    if (!isIsoDate(effectiveFrom)) {
      setError(t('rules.editor.invalid'))
      return
    }
    setBusy(true)
    try {
      const version = await client.createDraft(ruleSet.id, { effectiveFrom })
      onCreated(version.id)
    } catch (e) {
      setError(
        (e as { code?: string }).code === 'conflict' ? t('rules.error.conflict') : t('rules.error.generic'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={ruleSet !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{ruleSet ? t('rules.newDraft.title', { name: ruleSet.name }) : ''}</DialogTitle>
          <DialogDescription>{t('rules.newDraft.description')}</DialogDescription>
        </DialogHeader>
        <Field label={t('rules.editor.effectiveFrom')} required error={error ?? undefined}>
          {(aria) => (
            <Input {...aria} type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          )}
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void create()} aria-busy={busy || undefined} disabled={busy}>
            {t('rules.newDraft.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
