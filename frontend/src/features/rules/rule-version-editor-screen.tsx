import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  isIsoDate,
  validateRulePayload,
  type RoleCode,
  type RuleVersionDetail,
  type RuleVersionDiff,
  type RuleVersionImpact,
} from '@lanewise/shared'
import { Cluster, Section, Stack } from '@/components/layout'
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
  Pill,
  Skeleton,
  SkeletonText,
  StateBlock,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableRowHeader,
  TableWrap,
  Textarea,
  useUnsavedChanges,
} from '@/components/ui'
import { useI18n } from '@/i18n'
import { useDocumentTitle } from '@/features/auth/use-document-title'
import { RulesApiError, type RulesClient } from './api'
import { CALENDAR_DATE, STATUS_TONE, fieldLabel, statusLabel } from './labels'
import { availableActions, flattenLeaves, parseLeafInput, pathKey, setLeaf } from './logic'

export interface RuleVersionEditorScreenProps {
  readonly client: RulesClient
  /** The active role (demo role switcher, task 8.2); the API re-checks it. */
  readonly role: RoleCode | null
  readonly versionId: string
  /** Back to SCR-060. */
  readonly onBack?: () => void
}

interface Loaded {
  readonly version: RuleVersionDetail
  readonly impact: RuleVersionImpact
  readonly diff: RuleVersionDiff
}

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly referenceId?: string }
  | { readonly kind: 'ready'; readonly data: Loaded }

interface Draft {
  readonly effectiveFrom: string
  readonly changeNote: string
  readonly payload: Record<string, unknown>
}

type Confirm = 'submit' | 'publish' | 'approvePublish' | 'requestChanges' | null

const draftOf = (v: RuleVersionDetail): Draft => ({
  effectiveFrom: v.effectiveFrom,
  changeNote: v.changeNote,
  payload: v.payload as Record<string, unknown>,
})

const show = (value: unknown): string =>
  value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value)

/**
 * SCR-061 Rule version editor (requirement 16). The Rules Steward edits a
 * draft, submits cost rules to Finance and publishes; Finance approves or
 * requests changes (comment required). Shows the approval steps, the
 * scenarios a publish will mark stale and the changes from the previous
 * version.
 */
export function RuleVersionEditorScreen(props: RuleVersionEditorScreenProps) {
  // A different version is a fresh screen (loading state, no stale edits).
  return <Editor key={props.versionId} {...props} />
}

function Editor({ client, role, versionId, onBack }: RuleVersionEditorScreenProps) {
  const { t, formatDate } = useI18n()
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [json, setJson] = useState<string | null>(null)
  // What the user typed per field, so partial numbers like "0." survive re-render.
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [comment, setComment] = useState('')
  const [commentError, setCommentError] = useState<string | null>(null)

  const refresh = useCallback(
    (): Promise<void> =>
      Promise.all([client.getVersion(versionId), client.getDiff(versionId)]).then(
        ([{ version, impact }, diff]) => {
          setLoad({ kind: 'ready', data: { version, impact, diff } })
          setDraft(draftOf(version))
          setTexts({})
          setJson(null)
          setFieldErrors({})
        },
        (error: unknown) =>
          setLoad({ kind: 'error', referenceId: error instanceof RulesApiError ? (error.requestId ?? undefined) : undefined }),
      ),
    [client, versionId],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  const version = load.kind === 'ready' ? load.data.version : null
  useDocumentTitle(
    version
      ? t('rules.editor.pageTitle', { name: version.ruleSetName, version: version.version })
      : t('rules.list.pageTitle'),
  )
  const dirty = useMemo(
    () => version !== null && draft !== null && JSON.stringify(draftOf(version)) !== JSON.stringify(draft),
    [version, draft],
  )
  useUnsavedChanges(dirty)

  if (load.kind === 'error') {
    return (
      <StateBlock
        variant="error"
        title={t('rules.editor.error.title')}
        referenceId={load.referenceId}
        action={
          <Cluster gap={2}>
            <Button onClick={() => void refresh()}>{t('action.retry')}</Button>
            {onBack && <Button variant="ghost" onClick={onBack}>{t('rules.editor.back')}</Button>}
          </Cluster>
        }
      />
    )
  }
  if (load.kind === 'loading' || !draft) {
    return (
      <Stack gap={4} role="status" aria-live="polite">
        <span className="sr-only">{t('state.loading')}</span>
        <Skeleton className="h-8 w-1/2" />
        <SkeletonText lines={6} />
      </Stack>
    )
  }

  const { impact, diff } = load.data
  const v = load.data.version
  const actions = availableActions(role, v.status, v.isCostRule)
  const names = { name: v.ruleSetName, version: v.version }
  const staleCount = impact.scenarioIds.length
  const effectiveLabel = isIsoDate(draft.effectiveFrom) ? formatDate(draft.effectiveFrom, CALENDAR_DATE) : draft.effectiveFrom

  /** Client-side check with the same schema the API and engine use; returns true when valid. */
  const validate = (d: Draft, needNote: boolean): boolean => {
    const errs: Record<string, string> = {}
    if (!isIsoDate(d.effectiveFrom)) errs.effectiveFrom = t('rules.editor.invalid')
    if (needNote && d.changeNote.trim().length === 0) errs.changeNote = t('rules.editor.changeNote.hint')
    const result = validateRulePayload(v.ruleSetType, d.payload)
    if (!result.ok) for (const issue of result.issues) errs[`payload.${issue.path}`] = issue.message
    setFieldErrors(errs)
    if (Object.keys(errs).length > 0) {
      setNotice({ tone: 'danger', text: t('rules.editor.invalid') })
      return false
    }
    return true
  }

  const fail = (error: unknown) => {
    if (error instanceof RulesApiError && error.code === 'validation_failed') {
      const errs: Record<string, string> = {}
      for (const d of error.details) errs[d.path.replace(/^body\./, '')] = d.message
      setFieldErrors(errs)
      setNotice({ tone: 'danger', text: t('rules.editor.invalid') })
    } else if (error instanceof RulesApiError && error.code === 'conflict') {
      setNotice({ tone: 'warning', text: t('rules.error.conflict') })
    } else {
      setNotice({ tone: 'danger', text: t('rules.error.generic') })
    }
  }

  const run = async (op: () => Promise<string>) => {
    setBusy(true)
    setNotice(null)
    try {
      const message = await op()
      await refresh()
      setNotice({ tone: 'success', text: message })
    } catch (error) {
      fail(error)
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  /** Saves pending edits first so submit/publish act on what the user sees. */
  const saveIfDirty = async () => {
    if (!dirty) return
    await client.saveDraft(v.id, draft)
  }

  const onSave = () => {
    if (!validate(draft, false)) return
    void run(async () => {
      await client.saveDraft(v.id, draft)
      return t('rules.editor.saved')
    })
  }

  const openConfirm = (kind: Exclude<Confirm, null>) => {
    if ((kind === 'submit' || kind === 'publish') && actions.edit && !validate(draft, true)) return
    setComment('')
    setCommentError(null)
    setConfirm(kind)
  }

  const onConfirm = () => {
    switch (confirm) {
      case 'submit':
        return void run(async () => {
          await saveIfDirty()
          await client.submit(v.id)
          return t('rules.editor.submitted')
        })
      case 'publish':
        return void run(async () => {
          if (actions.edit) await saveIfDirty()
          const out = await client.publish(v.id)
          return t('rules.editor.published', { count: out.staleScenarioIds.length })
        })
      case 'approvePublish':
        return void run(async () => {
          await client.approve(v.id)
          const out = await client.publish(v.id)
          return t('rules.editor.published', { count: out.staleScenarioIds.length })
        })
      case 'requestChanges':
        if (comment.trim().length === 0) {
          setCommentError(t('rules.confirm.requestChanges.required'))
          return
        }
        return void run(async () => {
          await client.requestChanges(v.id, comment.trim())
          return t('rules.editor.changesRequested')
        })
      default:
        return undefined
    }
  }

  const leaves = flattenLeaves(draft.payload)
  // Parse typed input by the field's type in the saved version (a cleared number stays a number field).
  const savedLeaves = new Map(flattenLeaves(v.payload).map((l) => [pathKey(l.path), l.value]))
  const stepState = (done: boolean, current: boolean) =>
    done ? t('rules.editor.step.done') : current ? t('rules.editor.step.pending') : t('rules.editor.step.notYet')
  const submittedDone = ['submitted', 'approved', 'published', 'superseded'].includes(v.status)
  const financeDone = v.financeApprovedAt !== null
  const publishedDone = v.status === 'published' || v.status === 'superseded'

  return (
    <Stack gap={6}>
      {onBack && (
        <div>
          <Button variant="ghost" size="sm" onClick={onBack}>
            {t('rules.editor.back')}
          </Button>
        </div>
      )}

      <Cluster justify="between" gap={4}>
        <Cluster gap={3}>
          <h1 className="text-h1 text-text">{t('rules.editor.title', names)}</h1>
          <Pill>{v.isCostRule ? t('rules.editor.costRule') : t('rules.editor.nonCostRule')}</Pill>
          <StatusPill tone={STATUS_TONE[v.status]}>{statusLabel(t, v.status)}</StatusPill>
        </Cluster>
        <Cluster gap={2}>
          {actions.edit && (
            <>
              <Button variant="ghost" disabled={!dirty || busy} onClick={() => { setDraft(draftOf(v)); setTexts({}); setJson(null); setFieldErrors({}) }}>
                {t('rules.editor.discard')}
              </Button>
              <Button disabled={!dirty || busy} onClick={onSave}>
                {t('rules.editor.save')}
              </Button>
            </>
          )}
          {actions.submit && (
            <Button variant="primary" disabled={busy} onClick={() => openConfirm('submit')}>
              {t('rules.editor.submit')}
            </Button>
          )}
          {actions.requestChanges && (
            <Button disabled={busy} onClick={() => openConfirm('requestChanges')}>
              {t('rules.editor.requestChanges')}
            </Button>
          )}
          {actions.approveAndPublish && (
            <Button variant="primary" disabled={busy} onClick={() => openConfirm('approvePublish')}>
              {t('rules.editor.approveAndPublish')}
            </Button>
          )}
          {actions.publish && !actions.submit && (
            <Button variant="primary" disabled={busy} onClick={() => openConfirm('publish')}>
              {t('rules.editor.publish')}
            </Button>
          )}
        </Cluster>
      </Cluster>

      {notice && (
        <Alert tone={notice.tone} assertive={notice.tone === 'danger'}>
          {notice.text}
        </Alert>
      )}
      {dirty && !notice && (
        <Alert tone="info" live={false}>
          {t('rules.editor.unsaved')}
        </Alert>
      )}
      {v.reviewComment && (v.status === 'changes_requested' || v.status === 'draft') && (
        <Alert tone="warning" title={t('rules.editor.reviewComment.title')} live={false}>
          {v.reviewComment}
        </Alert>
      )}

      {v.isCostRule ? (
        <Section title={t('rules.editor.steps')}>
          <ol className="grid gap-3 sm:grid-cols-3">
            <li className="border-2 border-outline p-3">
              <span className="block text-label text-text">1 · {t('rules.editor.step.submitted')}</span>
              <span className="text-body-sm text-text-muted">{stepState(submittedDone, !submittedDone)}</span>
            </li>
            <li className="border-2 border-outline p-3">
              <span className="block text-label text-text">2 · {t('rules.editor.step.finance')}</span>
              <span className="block text-body-sm text-text-muted">
                {stepState(financeDone, v.status === 'submitted')}
                {v.financeApprovedByName ? ` · ${v.financeApprovedByName}` : ''}
              </span>
              <span className="text-body-sm text-text-muted">{t('rules.editor.step.requiredNote')}</span>
            </li>
            <li className="border-2 border-outline p-3">
              <span className="block text-label text-text">3 · {t('rules.editor.step.published')}</span>
              <span className="text-body-sm text-text-muted">{stepState(publishedDone, v.status === 'approved')}</span>
            </li>
          </ol>
        </Section>
      ) : (
        <p className="text-body-sm text-text-muted">{t('rules.editor.nonCostNote')}</p>
      )}

      {!publishedDone && (
        <Alert tone={staleCount > 0 ? 'warning' : 'info'} live={false}>
          {staleCount > 0 ? t('rules.editor.impact', { count: staleCount }) : t('rules.editor.impact.none')}
        </Alert>
      )}

      <Section title={t('rules.editor.details')}>
        <Field label={t('rules.editor.effectiveFrom')} required error={fieldErrors.effectiveFrom}>
          {(aria) => (
            <Input
              {...aria}
              type="date"
              value={draft.effectiveFrom}
              readOnly={!actions.edit}
              onChange={(e) => setDraft({ ...draft, effectiveFrom: e.target.value })}
            />
          )}
        </Field>
        <Field
          label={t('rules.editor.changeNote')}
          hint={t('rules.editor.changeNote.hint')}
          required
          error={fieldErrors.changeNote}
        >
          {(aria) => (
            <Textarea
              {...aria}
              value={draft.changeNote}
              readOnly={!actions.edit}
              onChange={(e) => setDraft({ ...draft, changeNote: e.target.value })}
            />
          )}
        </Field>
      </Section>

      <Section
        title={t('rules.editor.values')}
        description={actions.edit ? undefined : t('rules.editor.values.readOnly', { status: statusLabel(t, v.status) })}
      >
        {json === null ? (
          <div className="grid gap-4 md:grid-cols-2">
            {leaves.map((leaf) => {
              const key = pathKey(leaf.path)
              return (
                <Field key={key} label={fieldLabel(t, leaf.path)} error={fieldErrors[`payload.${key}`]}>
                  {(aria) => (
                    <Input
                      {...aria}
                      inputMode={typeof leaf.value === 'number' ? 'decimal' : undefined}
                      className={typeof leaf.value === 'number' ? 'lw-numeric' : undefined}
                      value={texts[key] ?? (leaf.value === null ? '' : String(leaf.value))}
                      readOnly={!actions.edit}
                      onChange={(e) => {
                        const typed = e.target.value
                        const saved = savedLeaves.has(key) ? (savedLeaves.get(key) ?? null) : leaf.value
                        setTexts({ ...texts, [key]: typed })
                        setDraft({
                          ...draft,
                          payload: setLeaf(draft.payload, leaf.path, parseLeafInput(saved, typed)) as Record<string, unknown>,
                        })
                      }}
                    />
                  )}
                </Field>
              )
            })}
          </div>
        ) : (
          <Field label={t('rules.editor.advanced.label')} error={fieldErrors.json}>
            {(aria) => (
              <Textarea
                {...aria}
                className="font-mono"
                rows={16}
                value={json}
                onChange={(e) => {
                  setJson(e.target.value)
                  try {
                    const parsed: unknown = JSON.parse(e.target.value)
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                      setDraft({ ...draft, payload: parsed as Record<string, unknown> })
                      setTexts({})
                      setFieldErrors((errs) => Object.fromEntries(Object.entries(errs).filter(([k]) => k !== 'json')))
                    }
                  } catch {
                    setFieldErrors((errs) => ({ ...errs, json: t('rules.editor.advanced.invalid') }))
                  }
                }}
              />
            )}
          </Field>
        )}
        {actions.edit && json === null && (
          <div>
            <Button variant="ghost" size="sm" onClick={() => setJson(JSON.stringify(draft.payload, null, 2))}>
              {t('rules.editor.advanced')}
            </Button>
          </div>
        )}
        {Object.keys(fieldErrors).some((k) => k.startsWith('payload.') && !leaves.some((l) => `payload.${pathKey(l.path)}` === k)) && (
          <ul className="text-body-sm text-on-danger-soft">
            {Object.entries(fieldErrors)
              .filter(([k]) => k.startsWith('payload.') && !leaves.some((l) => `payload.${pathKey(l.path)}` === k))
              .map(([k, message]) => (
                <li key={k}>
                  {k.slice('payload.'.length) || t('rules.editor.values')}: {message}
                </li>
              ))}
          </ul>
        )}
      </Section>

      <Section title={t('rules.editor.diff')}>
        {diff.fromVersionId === null ? (
          <p className="text-body text-text-muted">{t('rules.editor.diff.first')}</p>
        ) : diff.changes.length === 0 ? (
          <p className="text-body text-text-muted">{t('rules.editor.diff.none')}</p>
        ) : (
          <TableWrap>
            <Table>
              <caption className="sr-only">{t('rules.editor.diff.caption')}</caption>
              <TableHead>
                <tr>
                  <TableHeaderCell>{t('rules.editor.diff.field')}</TableHeaderCell>
                  <TableHeaderCell>{t('rules.editor.diff.before')}</TableHeaderCell>
                  <TableHeaderCell>{t('rules.editor.diff.after')}</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {diff.changes.map((c) => (
                  <TableRow key={pathKey(c.path)}>
                    <TableRowHeader>{fieldLabel(t, c.path)}</TableRowHeader>
                    <TableCell className="lw-numeric">{c.kind === 'added' ? t('rules.editor.diff.absent') : show(c.before)}</TableCell>
                    <TableCell className="lw-numeric">{c.kind === 'removed' ? t('rules.editor.diff.absent') : show(c.after)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrap>
        )}
      </Section>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === 'submit' && t('rules.confirm.submit.title', names)}
              {confirm === 'publish' && t('rules.confirm.publish.title', names)}
              {confirm === 'approvePublish' && t('rules.confirm.approvePublish.title', names)}
              {confirm === 'requestChanges' && t('rules.confirm.requestChanges.title', names)}
            </DialogTitle>
            {confirm !== 'requestChanges' && (
              <DialogDescription>
                {confirm === 'submit' && t('rules.confirm.submit.body')}
                {confirm === 'publish' && t('rules.confirm.publish.body', { date: effectiveLabel, count: staleCount })}
                {confirm === 'approvePublish' &&
                  t('rules.confirm.approvePublish.body', { date: effectiveLabel, count: staleCount })}
              </DialogDescription>
            )}
          </DialogHeader>
          {confirm === 'requestChanges' && (
            <Field label={t('rules.confirm.requestChanges.comment')} required error={commentError ?? undefined}>
              {(aria) => <Textarea {...aria} value={comment} onChange={(e) => setComment(e.target.value)} />}
            </Field>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              {t('action.cancel')}
            </Button>
            <Button variant="primary" disabled={busy} aria-busy={busy || undefined} onClick={onConfirm}>
              {confirm === 'submit' && t('rules.confirm.submit.action')}
              {confirm === 'publish' && t('rules.editor.publish')}
              {confirm === 'approvePublish' && t('rules.editor.approveAndPublish')}
              {confirm === 'requestChanges' && t('rules.editor.requestChanges')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Stack>
  )
}
