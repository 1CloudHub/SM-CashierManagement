import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  isIsoDate,
  validateRulePayload,
  type RoleCode,
  type RuleVersionDetail,
  type RuleVersionDiff,
  type RuleVersionImpact,
} from '@lanewise/shared'
import { Cluster, Section, Stack, useMediaQuery } from '@/components/layout'
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
import { CALENDAR_DATE, STATUS_TONE, fieldLabel, formatRuleValue, isDataKey, statusLabel } from './labels'
import {
  availableActions,
  flattenLeaves,
  groupLeaves,
  keyPath,
  parseLeafInput,
  pathKey,
  previousValue,
  setLeaf,
  type Leaf,
  type LeafPath,
} from './logic'

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
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'ready'; readonly data: Loaded }

interface Draft {
  readonly effectiveFrom: string
  readonly changeNote: string
  readonly payload: Record<string, unknown>
}

type Confirm = 'submit' | 'publish' | 'approvePublish' | 'requestChanges' | 'discard' | null

interface Notice {
  readonly tone: 'success' | 'danger' | 'warning'
  readonly text: string
}

/** Below the tablet breakpoint (600px) the editor is read-only (wireframe: "Read-only on a phone"). */
const PHONE_QUERY = '(max-width: 37.4375rem)'

const draftOf = (v: RuleVersionDetail): Draft => ({
  effectiveFrom: v.effectiveFrom,
  changeNote: v.changeNote,
  payload: v.payload as Record<string, unknown>,
})

/** Field keys that have their own control; any other error key is listed in the summary alert. */
const FIXED_FIELDS = new Set(['effectiveFrom', 'changeNote', 'json'])

/**
 * SCR-061 Rule version editor (requirement 16). The Rules Steward edits a
 * draft, submits cost rules to Finance and publishes; Finance approves and
 * publishes in one step, or requests changes (comment required). Shows the
 * approval steps, the scenarios a publish will mark stale and the changes
 * from the previous version. Read-only on a phone.
 */
export function RuleVersionEditorScreen(props: RuleVersionEditorScreenProps) {
  // A different version is a fresh screen (loading state, no stale edits).
  return <Editor key={props.versionId} {...props} />
}

function Editor({ client, role, versionId, onBack }: RuleVersionEditorScreenProps) {
  const { t, formatDate, formatNumber } = useI18n()
  const isPhone = useMediaQuery(PHONE_QUERY)
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [json, setJson] = useState<string | null>(null)
  // What the user typed per field, so partial numbers like "0." survive re-render.
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [comment, setComment] = useState('')
  const [commentError, setCommentError] = useState<string | null>(null)

  // Ignore responses that land after the screen has gone.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(
    (): Promise<void> =>
      Promise.all([client.getVersion(versionId), client.getDiff(versionId)]).then(
        ([{ version, impact }, diff]) => {
          if (!mounted.current) return
          setLoad({ kind: 'ready', data: { version, impact, diff } })
          setDraft(draftOf(version))
          setTexts({})
          setJson(null)
          setFieldErrors({})
        },
        (error: unknown) => {
          if (!mounted.current) return
          setLoad(
            error instanceof RulesApiError && error.status === 403
              ? { kind: 'forbidden' }
              : { kind: 'error', referenceId: error instanceof RulesApiError ? (error.requestId ?? undefined) : undefined },
          )
        },
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

  if (load.kind === 'forbidden') {
    return (
      <StateBlock
        variant="no-access"
        title={t('rules.list.noAccess.title')}
        description={t('rules.list.noAccess.description')}
        action={onBack && <Button onClick={onBack}>{t('rules.editor.back')}</Button>}
      />
    )
  }
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
  const allowed = availableActions(role, v.status, v.isCostRule)
  // On a phone every action is hidden and the content is read-only.
  const actions = isPhone
    ? { edit: false, submit: false, approve: false, requestChanges: false, approveAndPublish: false, publish: false }
    : allowed
  const hiddenOnPhone = isPhone && Object.values(allowed).some(Boolean)
  const names = { name: v.ruleSetName, version: v.version }
  const staleCount = impact.scenarioIds.length
  const effectiveLabel = isIsoDate(draft.effectiveFrom) ? formatDate(draft.effectiveFrom, CALENDAR_DATE) : draft.effectiveFrom
  const fmt = { t, formatNumber, formatDate: (value: string, options?: Intl.DateTimeFormatOptions) => formatDate(value, options) }
  const jsonInvalid = json !== null && fieldErrors.json !== undefined
  // Finance can't add the change note, so a version without one can't be published by them (the API refuses it too).
  const missingNote = v.changeNote.trim().length === 0
  const publishBlocked = missingNote && !actions.edit

  /** Every edit goes through here: it clears a stale success notice. */
  const edit = (next: Draft) => {
    setDraft(next)
    if (notice?.tone === 'success') setNotice(null)
  }

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

  const fail = (error: unknown, kind: Confirm) => {
    if (error instanceof RulesApiError && error.code === 'validation_failed') {
      const errs: Record<string, string> = {}
      for (const d of error.details) errs[d.path.replace(/^body\./, '')] = d.message
      setFieldErrors(errs)
      setNotice({ tone: 'danger', text: t('rules.editor.invalid') })
    } else if (error instanceof RulesApiError && error.status === 403) {
      setNotice({ tone: 'danger', text: t('rules.error.forbidden') })
    } else if (error instanceof RulesApiError && error.code === 'conflict') {
      setNotice({
        tone: 'warning',
        text: kind === 'approvePublish' ? t('rules.error.approvePublishConflict') : t('rules.error.conflict'),
      })
    } else {
      setNotice({ tone: 'danger', text: kind === 'approvePublish' ? t('rules.error.approvePublish') : t('rules.error.generic') })
    }
  }

  const run = async (kind: Confirm, op: () => Promise<string>) => {
    setBusy(true)
    setNotice(null)
    try {
      const message = await op()
      await refresh()
      if (mounted.current) setNotice({ tone: 'success', text: message })
    } catch (error) {
      if (mounted.current) fail(error, kind)
    } finally {
      if (mounted.current) {
        setBusy(false)
        setConfirm(null)
      }
    }
  }

  /** Saves pending edits first so submit/publish act on what the user sees. */
  const saveIfDirty = async () => {
    if (!dirty) return
    await client.saveDraft(v.id, draft)
  }

  const onSave = () => {
    if (!validate(draft, false)) return
    void run(null, async () => {
      await client.saveDraft(v.id, draft)
      return t('rules.editor.saved')
    })
  }

  const discard = () => {
    setDraft(draftOf(v))
    setTexts({})
    setJson(null)
    setFieldErrors({})
    setNotice(null)
    setConfirm(null)
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
        return void run('submit', async () => {
          await saveIfDirty()
          await client.submit(v.id)
          return t('rules.editor.submitted')
        })
      case 'publish':
        return void run('publish', async () => {
          if (actions.edit) await saveIfDirty()
          const out = await client.publish(v.id)
          return t('rules.editor.published', { count: out.staleScenarioIds.length })
        })
      case 'approvePublish':
        // One server operation: approved and published together, or neither.
        return void run('approvePublish', async () => {
          const out = await client.approveAndPublish(v.id)
          return t('rules.editor.published', { count: out.staleScenarioIds.length })
        })
      case 'requestChanges':
        if (comment.trim().length === 0) {
          setCommentError(t('rules.confirm.requestChanges.required'))
          return
        }
        return void run('requestChanges', async () => {
          await client.requestChanges(v.id, comment.trim())
          return t('rules.editor.changesRequested')
        })
      case 'discard':
        return discard()
      default:
        return undefined
    }
  }

  const leaves = flattenLeaves(draft.payload)
  const groups = groupLeaves(leaves, isDataKey)
  // Parse typed input by the field's type in the saved version (a cleared number stays a number field).
  const savedLeaves = new Map<string, unknown>(flattenLeaves(v.payload).map((l) => [pathKey(l.path), l.value]))
  const leafKeys = new Set(leaves.map((l) => `payload.${pathKey(l.path)}`))
  const unmapped = Object.entries(fieldErrors).filter(([k]) => !FIXED_FIELDS.has(k) && !leafKeys.has(k))
  const errorLabel = (key: string): string =>
    key === 'payload'
      ? t('rules.editor.values')
      : key.startsWith('payload.')
        ? fieldLabel(t, keyPath(key.slice('payload.'.length)))
        : fieldLabel(t, keyPath(key))

  const leafText = (leaf: Leaf): string => {
    const key = pathKey(leaf.path)
    return texts[key] ?? (leaf.value === null ? '' : String(leaf.value))
  }
  const onLeafChange = (leaf: Leaf, typed: string) => {
    const key = pathKey(leaf.path)
    const saved = savedLeaves.has(key) ? ((savedLeaves.get(key) as Leaf['value']) ?? null) : leaf.value
    setTexts({ ...texts, [key]: typed })
    edit({ ...draft, payload: setLeaf(draft.payload, leaf.path, parseLeafInput(saved, typed)) as Record<string, unknown> })
  }
  const numericClass = (leaf: Leaf) => (typeof leaf.value === 'number' ? 'lw-numeric' : undefined)

  const step = (done: boolean, current: boolean, by: string | null, at: string | null) => {
    const state = done ? t('rules.editor.step.done') : current ? t('rules.editor.step.pending') : t('rules.editor.step.notYet')
    if (!done) return state
    const when = at ? formatDate(at, { dateStyle: 'medium' }) : null
    return [state, by, when].filter(Boolean).join(' · ')
  }
  const submittedDone = ['submitted', 'approved', 'published', 'superseded'].includes(v.status)
  const financeDone = v.financeApprovedAt !== null
  const publishedDone = v.status === 'published' || v.status === 'superseded'
  const saveBlocked = busy || jsonInvalid

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
              <Button variant="secondary" disabled={!dirty || busy} onClick={() => setConfirm('discard')}>
                {t('rules.editor.discard')}
              </Button>
              <Button disabled={!dirty || saveBlocked} onClick={onSave}>
                {t('rules.editor.save')}
              </Button>
            </>
          )}
          {actions.submit && (
            <Button variant="primary" disabled={saveBlocked} onClick={() => openConfirm('submit')}>
              {t('rules.editor.submit')}
            </Button>
          )}
          {actions.requestChanges && (
            <Button disabled={busy} onClick={() => openConfirm('requestChanges')}>
              {t('rules.editor.requestChanges')}
            </Button>
          )}
          {actions.approveAndPublish && (
            <Button variant="primary" disabled={busy || publishBlocked} onClick={() => openConfirm('approvePublish')}>
              {t('rules.editor.approveAndPublish')}
            </Button>
          )}
          {actions.publish && !actions.submit && (
            <Button variant="primary" disabled={saveBlocked || publishBlocked} onClick={() => openConfirm('publish')}>
              {t('rules.editor.publish')}
            </Button>
          )}
        </Cluster>
      </Cluster>

      {hiddenOnPhone && (
        <Alert tone="info" live={false}>
          {t('rules.editor.phoneReadOnly')}
        </Alert>
      )}
      {notice && (
        <Alert tone={notice.tone} assertive={notice.tone === 'danger'}>
          {notice.text}
        </Alert>
      )}
      {jsonInvalid && (
        <Alert tone="danger" assertive>
          {t('rules.editor.advanced.blocked')}
        </Alert>
      )}
      {unmapped.length > 0 && (
        <Alert tone="danger" title={t('rules.editor.otherErrors')} live={false}>
          <ul className="list-disc pl-5">
            {unmapped.map(([k, message]) => (
              <li key={k}>
                {errorLabel(k)}: {message}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {(actions.approveAndPublish || (actions.publish && !actions.edit)) && missingNote && (
        <Alert tone="warning" live={false}>
          {t('rules.editor.noteRequiredToPublish')}
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
          <ol className="grid gap-3 tablet:grid-cols-3">
            <li className="border border-outline p-3">
              <span className="block text-label text-text">1 · {t('rules.editor.step.submitted')}</span>
              <span className="text-body-sm text-text-muted">
                {step(submittedDone, !submittedDone, v.submittedByName, v.submittedAt)}
              </span>
            </li>
            <li className="border border-outline p-3">
              <span className="block text-label text-text">2 · {t('rules.editor.step.finance')}</span>
              <span className="block text-body-sm text-text-muted">
                {step(financeDone, v.status === 'submitted', v.financeApprovedByName, v.financeApprovedAt)}
              </span>
              <span className="text-body-sm text-text-muted">{t('rules.editor.step.requiredNote')}</span>
            </li>
            <li className="border border-outline p-3">
              <span className="block text-label text-text">3 · {t('rules.editor.step.published')}</span>
              <span className="text-body-sm text-text-muted">
                {step(publishedDone, v.status === 'approved', v.publishedByName, v.publishedAt)}
              </span>
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
        {actions.edit ? (
          <>
            <Field label={t('rules.editor.effectiveFrom')} required error={fieldErrors.effectiveFrom}>
              {(aria) => (
                <Input
                  {...aria}
                  type="date"
                  value={draft.effectiveFrom}
                  onChange={(e) => edit({ ...draft, effectiveFrom: e.target.value })}
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
                <Textarea {...aria} value={draft.changeNote} onChange={(e) => edit({ ...draft, changeNote: e.target.value })} />
              )}
            </Field>
          </>
        ) : (
          <dl className="grid gap-4 tablet:grid-cols-2">
            <ReadOnly label={t('rules.editor.effectiveFrom')} value={effectiveLabel} />
            <ReadOnly
              label={t('rules.editor.changeNote')}
              value={v.changeNote.trim() ? v.changeNote : t('rules.editor.diff.absent')}
              error={fieldErrors.changeNote}
            />
          </dl>
        )}
      </Section>

      <Section
        title={t('rules.editor.values')}
        description={actions.edit || isPhone ? undefined : t('rules.editor.values.readOnly', { status: statusLabel(t, v.status) })}
      >
        {json !== null ? (
          <Field label={t('rules.editor.advanced.label')} error={fieldErrors.json}>
            {(aria) => (
              <Textarea
                {...aria}
                className="font-mono"
                rows={16}
                value={json}
                onChange={(e) => {
                  setJson(e.target.value)
                  if (notice?.tone === 'success') setNotice(null)
                  try {
                    const parsed: unknown = JSON.parse(e.target.value)
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
                    setDraft({ ...draft, payload: parsed as Record<string, unknown> })
                    setTexts({})
                    setFieldErrors((errs) => Object.fromEntries(Object.entries(errs).filter(([k]) => k !== 'json')))
                  } catch {
                    setFieldErrors((errs) => ({ ...errs, json: t('rules.editor.advanced.invalid') }))
                  }
                }}
              />
            )}
          </Field>
        ) : (
          <Stack gap={6}>
            {chunkFields(groups).map((chunk) =>
              chunk.kind === 'table' ? (
                <RatesTable
                  key={pathKey(chunk.path)}
                  path={chunk.path}
                  rows={chunk.rows}
                  editable={actions.edit}
                  text={leafText}
                  onChange={onLeafChange}
                  errors={fieldErrors}
                  was={(path) => {
                    const prev = previousValue(diff, savedLeaves, path)
                    return prev.present ? formatRuleValue(fmt, prev.value) : t('rules.editor.diff.absent')
                  }}
                  format={(value) => formatRuleValue(fmt, value)}
                />
              ) : actions.edit ? (
                <div key={chunk.leaves.map((l) => pathKey(l.path)).join('|')} className="grid gap-4 tablet:grid-cols-2">
                  {chunk.leaves.map((leaf) => (
                    <Field key={pathKey(leaf.path)} label={fieldLabel(t, leaf.path)} error={fieldErrors[`payload.${pathKey(leaf.path)}`]}>
                      {(aria) => (
                        <Input
                          {...aria}
                          inputMode={typeof leaf.value === 'number' ? 'decimal' : undefined}
                          className={numericClass(leaf)}
                          value={leafText(leaf)}
                          onChange={(e) => onLeafChange(leaf, e.target.value)}
                        />
                      )}
                    </Field>
                  ))}
                </div>
              ) : (
                <dl key={chunk.leaves.map((l) => pathKey(l.path)).join('|')} className="grid gap-4 tablet:grid-cols-2">
                  {chunk.leaves.map((leaf) => (
                    <ReadOnly
                      key={pathKey(leaf.path)}
                      label={fieldLabel(t, leaf.path)}
                      value={formatRuleValue(fmt, leaf.value)}
                      numeric={typeof leaf.value === 'number'}
                      error={fieldErrors[`payload.${pathKey(leaf.path)}`]}
                    />
                  ))}
                </dl>
              ),
            )}
          </Stack>
        )}
        {actions.edit && json === null && (
          <div>
            <Button variant="ghost" size="sm" onClick={() => setJson(JSON.stringify(draft.payload, null, 2))}>
              {t('rules.editor.advanced')}
            </Button>
          </div>
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
                    <TableCell className="lw-numeric">
                      {c.kind === 'added' ? t('rules.editor.diff.absent') : formatRuleValue(fmt, c.before)}
                    </TableCell>
                    <TableCell className="lw-numeric">
                      {c.kind === 'removed' ? t('rules.editor.diff.absent') : formatRuleValue(fmt, c.after)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrap>
        )}
      </Section>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && !busy && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === 'submit' && t('rules.confirm.submit.title', names)}
              {confirm === 'publish' && t('rules.confirm.publish.title', names)}
              {confirm === 'approvePublish' && t('rules.confirm.approvePublish.title', names)}
              {confirm === 'requestChanges' && t('rules.confirm.requestChanges.title', names)}
              {confirm === 'discard' && t('rules.confirm.discard.title')}
            </DialogTitle>
            {confirm !== 'requestChanges' && (
              <DialogDescription>
                {confirm === 'submit' && t('rules.confirm.submit.body')}
                {confirm === 'publish' && t('rules.confirm.publish.body', { date: effectiveLabel, count: staleCount })}
                {confirm === 'approvePublish' &&
                  t('rules.confirm.approvePublish.body', { date: effectiveLabel, count: staleCount })}
                {confirm === 'discard' && t('rules.confirm.discard.body')}
              </DialogDescription>
            )}
          </DialogHeader>
          {confirm === 'requestChanges' && (
            <Field label={t('rules.confirm.requestChanges.comment')} required error={commentError ?? undefined}>
              {(aria) => <Textarea {...aria} value={comment} onChange={(e) => setComment(e.target.value)} />}
            </Field>
          )}
          <DialogFooter>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirm(null)}>
              {confirm === 'discard' ? t('rules.confirm.discard.keep') : t('action.cancel')}
            </Button>
            <Button
              variant={confirm === 'discard' ? 'danger' : 'primary'}
              loading={busy}
              loadingLabel={t('rules.working')}
              onClick={onConfirm}
            >
              {confirm === 'submit' && t('rules.confirm.submit.action')}
              {confirm === 'publish' && t('rules.editor.publish')}
              {confirm === 'approvePublish' && t('rules.editor.approveAndPublish')}
              {confirm === 'requestChanges' && t('rules.editor.requestChanges')}
              {confirm === 'discard' && t('rules.editor.discard')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Stack>
  )
}

type Chunk =
  | { readonly kind: 'fields'; readonly leaves: readonly Leaf[] }
  | { readonly kind: 'table'; readonly path: LeafPath; readonly rows: readonly Leaf[] }

/** Consecutive plain fields share one grid; each keyed map is its own table. */
function chunkFields(groups: ReturnType<typeof groupLeaves>): Chunk[] {
  const out: Chunk[] = []
  for (const g of groups) {
    if (g.kind === 'table') {
      out.push(g)
      continue
    }
    const prev = out[out.length - 1]
    if (prev?.kind === 'fields') out[out.length - 1] = { kind: 'fields', leaves: [...prev.leaves, g.leaf] }
    else out.push({ kind: 'fields', leaves: [g.leaf] })
  }
  return out
}

/** A read-only value as text (no input, no required mark). */
function ReadOnly({ label, value, numeric, error }: { label: string; value: string; numeric?: boolean; error?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-label text-text-muted">{label}</dt>
      <dd className={numeric ? 'lw-numeric text-body text-text' : 'whitespace-pre-wrap text-body text-text'}>{value}</dd>
      {error && <dd className="text-body-sm text-on-danger-soft">{error}</dd>}
    </div>
  )
}

/**
 * A keyed map of values — the base rate per region — as a table with the
 * previous version's value ("Was") next to each (wireframe SCR-061 "Rates").
 */
function RatesTable({
  path,
  rows,
  editable,
  text,
  onChange,
  errors,
  was,
  format,
}: {
  path: LeafPath
  rows: readonly Leaf[]
  editable: boolean
  text: (leaf: Leaf) => string
  onChange: (leaf: Leaf, typed: string) => void
  errors: Readonly<Record<string, string>>
  was: (path: LeafPath) => string
  format: (value: unknown) => string
}) {
  const { t } = useI18n()
  const baseId = useId()
  const title = fieldLabel(t, path)
  const keyHeader = path[path.length - 1] === 'hourlyRateByRegion' ? t('rules.editor.table.region') : t('rules.editor.table.key')
  return (
    <TableWrap>
      <Table>
        <caption className="text-left text-h3 text-text">{title}</caption>
        <TableHead>
          <tr>
            <TableHeaderCell>{keyHeader}</TableHeaderCell>
            <TableHeaderCell numeric>{t('rules.editor.table.value')}</TableHeaderCell>
            <TableHeaderCell numeric>{t('rules.editor.table.was')}</TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          {rows.map((leaf, i) => {
            const key = pathKey(leaf.path)
            const name = String(leaf.path[leaf.path.length - 1])
            const error = errors[`payload.${key}`]
            const errorId = `${baseId}-error-${i}`
            return (
              <TableRow key={key}>
                <TableRowHeader>{name}</TableRowHeader>
                <TableCell numeric>
                  {editable ? (
                    <div className="flex flex-col items-end gap-1">
                      <Input
                        aria-label={`${title} › ${name}`}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? errorId : undefined}
                        inputMode={typeof leaf.value === 'number' ? 'decimal' : undefined}
                        className="lw-numeric max-w-40 text-right"
                        value={text(leaf)}
                        onChange={(e) => onChange(leaf, e.target.value)}
                      />
                      {error && (
                        <span id={errorId} className="text-body-sm text-on-danger-soft">
                          {error}
                        </span>
                      )}
                    </div>
                  ) : (
                    <>
                      <span className="lw-numeric">{format(leaf.value)}</span>
                      {error && <span className="block text-body-sm text-on-danger-soft">{error}</span>}
                    </>
                  )}
                </TableCell>
                <TableCell numeric className="text-text-muted">
                  {was(leaf.path)}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableWrap>
  )
}
