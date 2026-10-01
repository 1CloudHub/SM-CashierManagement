import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import type {
  IsoDate,
  LaborBreach,
  OverrideCheck,
  ReplacementCandidate,
  RosterDetail,
  RosterSummary,
  ShiftOverrideRequest,
} from '@lanewise/shared'
import { ApiError } from '@/api'
import { useAnnouncer } from '@/components/a11y'
import { Cluster, Stack } from '@/components/layout'
import { Alert } from '@/components/ui/alert'
import { Field } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { StateBlock } from '@/components/ui/state-block'
import { STATUS_META } from '@/components/ui/status'
import { cn } from '@/lib/utils'
import type { RosterClient } from './api'
import { checkBreaches, dayRows, gridRows, monthCoverage, rosterTotals, toRosterModel, type RosterModel } from './adapt'
import { DayTimeline } from './day-timeline'
import { MobileDayList, MobileWeekList } from './mobile-roster'
import { DEFAULT_DAY_WINDOW, gridDays, monthWeeks } from './model'
import { MonthCoverage } from './month-coverage'
import { RosterGrid } from './roster-grid'
import { RosterLegend } from './roster-legend'
import { RosterZoom } from './roster-zoom'
import { ShiftEditor, type Replacement, type RuleCheck, type ShiftDraft } from './shift-editor'
import type { RosterShift, RosterView } from './types'
import { useRosterFormat, type RosterFormat } from './use-roster-format'

export interface RosterScreenProps {
  client: RosterClient
  /** Store from the context bar; null until one is picked. */
  storeId: string | null
  /** Department from the context bar, used to pick the department roster. */
  departmentId?: string | null
  /** Phones: Day/Week become lists and only emergency off / reassign is editable (req. 6.5). */
  isPhone?: boolean
}

/** What the shift editor is open on: an existing shift (maybe with dragged times) or a new one. */
type Editing =
  | { kind: 'shift'; shift: RosterShift; mobile: boolean }
  | { kind: 'add'; shift: RosterShift; staffId: string }

const NEW_SHIFT_ID = '__new__'

function breachText(f: RosterFormat, b: LaborBreach, detail: RosterDetail): string {
  const s = detail.staff.find((x) => x.id === b.staffId)
  return f.t(`roster.rule.${b.rule}`, { who: s ? `${s.employeeNo} ${s.name}` : '', date: f.day(b.date) })
}

function toRuleChecks(f: RosterFormat, check: OverrideCheck, detail: RosterDetail): RuleCheck[] {
  const breaches = checkBreaches(check)
  if (breaches.length === 0) return [{ id: 'ok', tone: 'success', text: f.t('roster.screen.ruleOk') }]
  return breaches.map((b) => ({
    id: `${b.rule}|${b.staffId}|${b.date}`,
    tone: b.severity === 'block' ? 'danger' : 'warning',
    text: breachText(f, b, detail),
  }))
}

function toReplacements(f: RosterFormat, candidates: readonly ReplacementCandidate[]): Replacement[] {
  return candidates.map((c) => ({
    cashierId: c.staffId,
    label: f.t('roster.screen.replacementLabel', { code: c.employeeNo, name: c.name, hours: f.num(c.weekHours) }),
    eligible: c.check.status === 'ok',
    blocked: c.check.status === 'blocked',
  }))
}

/**
 * SCR-022 Weekly roster over a published roster (task 13.4 — requirements
 * 6 and 7; wireframe scr-022-roster.html). Day timeline, Week / Fortnight /
 * Four weeks grid and Month coverage from the task 13.1–13.3 components;
 * clicking a shift opens the shift editor (edit shift, emergency off /
 * reassign with ranked replacements) with the server's live labor-rule check.
 * A warning needs a reason, a block (missed 24-hour rest, overlap) can't be
 * saved; saved changes come back marked ✎ and listed under "Changes".
 * Only the Store Manager edits (`canOverride` from the API); everyone else
 * reads.
 */
export function RosterScreen({ client, storeId, departmentId = null, isPhone = false }: RosterScreenProps) {
  const f = useRosterFormat()
  const uid = useId()
  const { announce } = useAnnouncer()

  const [rosters, setRosters] = useState<readonly RosterSummary[] | null>(null)
  const [rosterId, setRosterId] = useState<string | null>(null)
  const [detail, setDetail] = useState<RosterDetail | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [view, setView] = useState<RosterView>('week')
  const [anchor, setAnchor] = useState<IsoDate | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string } | null>(null)

  const [editing, setEditing] = useState<Editing | null>(null)
  const [draftCheck, setDraftCheck] = useState<OverrideCheck | null>(null)
  const [pendingDraft, setPendingDraft] = useState<ShiftOverrideRequest | null>(null)
  const [replacements, setReplacements] = useState<readonly ReplacementCandidate[] | null>(null)

  // Rosters of the store; pick the context department's (else the first).
  useEffect(() => {
    if (!storeId) return
    // The page remounts this screen per store, so there is no stale roster to clear here.
    let live = true
    client.list(storeId).then(
      (list) => {
        if (!live) return
        setRosters(list)
        setRosterId((list.find((r) => r.departmentId === departmentId) ?? list[0])?.id ?? null)
      },
      (e: unknown) => live && setError(e),
    )
    return () => {
      live = false
    }
  }, [client, storeId, departmentId])

  useEffect(() => {
    if (!storeId || !rosterId) return
    let live = true
    client.get(storeId, rosterId).then(
      (d) => {
        if (!live) return
        setDetail(d)
        setAnchor((a) => (a && a >= d.roster.periodStart && a <= d.roster.periodEnd ? a : d.roster.periodStart))
      },
      (e: unknown) => live && setError(e),
    )
    return () => {
      live = false
    }
  }, [client, storeId, rosterId])

  const model: RosterModel | null = useMemo(() => (detail ? toRosterModel(detail) : null), [detail])

  // Live rule check of the editor's draft (debounced).
  useEffect(() => {
    if (!pendingDraft || !storeId || !rosterId) return
    let live = true
    const timer = setTimeout(() => {
      client.check(storeId, rosterId, pendingDraft).then(
        (c) => live && setDraftCheck(c),
        () => live && setDraftCheck(null),
      )
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [client, storeId, rosterId, pendingDraft])

  const canOverride = detail?.canOverride ?? false

  const draftRequest = useCallback(
    (e: Editing, d: { startMin: number; endMin: number; activities: readonly ShiftDraft['activities'][number][] }): ShiftOverrideRequest =>
      e.kind === 'add'
        ? { type: 'add', staffId: e.staffId, departmentId: e.shift.departmentId, date: e.shift.date, startMin: d.startMin, endMin: d.endMin }
        : {
            type: 'time_change',
            shiftId: e.shift.id,
            date: e.shift.date,
            startMin: d.startMin,
            endMin: d.endMin,
            // The editor flags activities outside the shift and won't save them; check the rest meanwhile.
            activities: d.activities.filter((a) => a.startMin >= d.startMin && a.endMin <= d.endMin),
          },
    [],
  )

  const open = useCallback(
    (e: Editing) => {
      setEditing(e)
      setDraftCheck(null)
      setReplacements(null)
      setPendingDraft(e.kind === 'shift' && e.mobile ? null : draftRequest(e, e.shift))
      if (e.kind === 'shift' && storeId && rosterId) {
        client.replacements(storeId, rosterId, e.shift.id).then(setReplacements, () => setReplacements([]))
      } else {
        setReplacements([])
      }
    },
    [client, storeId, rosterId, draftRequest],
  )

  const openShift = (shiftId: string, mobile = false, times?: { startMin: number; endMin: number }) => {
    const shift = model?.shifts.find((s) => s.id === shiftId)
    if (!shift || !canOverride) return
    open({ kind: 'shift', shift: times ? { ...shift, ...times } : shift, mobile })
  }

  const close = () => {
    setEditing(null)
    setPendingDraft(null)
    setDraftCheck(null)
  }

  const submit = async (change: ShiftOverrideRequest) => {
    if (!storeId || !rosterId) return
    try {
      const res = await client.override(storeId, rosterId, change)
      setDetail(res.roster)
      close()
      setNotice({ tone: 'success', text: f.t('roster.screen.saved') })
      announce(f.t('roster.screen.saved'))
    } catch (e) {
      const code = e instanceof ApiError ? e.code : null
      const title =
        code === 'conflict'
          ? f.t('roster.screen.blocked')
          : code === 'validation_failed'
            ? f.t('roster.screen.reasonRequired')
            : f.t('roster.screen.failed')
      setNotice({ tone: code === 'validation_failed' ? 'warning' : 'danger', text: title })
      announce(title)
    }
  }

  if (!storeId) return <StateBlock title={f.t('roster.screen.noStore')} />
  if (error) {
    return (
      <StateBlock
        variant="error"
        title={f.t('roster.screen.loadError')}
        referenceId={error instanceof ApiError ? (error.requestId ?? undefined) : undefined}
      />
    )
  }
  if (rosters === null || (rosterId !== null && (detail === null || model === null || anchor === null))) {
    return (
      <Stack gap={3} aria-busy="true">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-64 w-full" />
      </Stack>
    )
  }
  if (rosterId === null || !detail || !model || !anchor) return <StateBlock title={f.t('roster.screen.noRoster')} />

  const period = { from: detail.roster.periodStart, to: detail.roster.periodEnd }
  const department = (id: string) => model.departments.find((d) => d.id === id)
  const editable = canOverride && !isPhone

  const renderView = (v: RosterView) => {
    if (v === 'day') {
      return isPhone ? (
        <MobileDayList
          date={anchor}
          rows={dayRows(model, anchor)}
          departments={model.departments}
          {...(canOverride ? { onEmergencyOff: (id: string) => openShift(id, true) } : {})}
        />
      ) : (
        <DayTimeline
          date={anchor}
          rows={dayRows(model, anchor)}
          departments={model.departments}
          requirements={[]}
          editable={editable}
          onOpenShift={(id) => openShift(id)}
          onShiftChange={(c) => openShift(c.shiftId, false, { startMin: c.startMin, endMin: c.endMin })}
        />
      )
    }
    if (v === 'month') {
      const dates = monthWeeks(anchor).flat().filter((d): d is IsoDate => d !== null)
      return <MonthCoverage month={anchor} days={monthCoverage(model, dates)} onOpenDay={(d) => (setAnchor(d), setView('day'))} />
    }
    const days = gridDays(anchor, v)
    return isPhone ? (
      <MobileWeekList
        days={days}
        rows={gridRows(model, days, period)}
        departments={model.departments}
        openShifts={model.openShifts}
        {...(canOverride ? { onEmergencyOff: (id: string) => openShift(id, true) } : {})}
      />
    ) : (
      <RosterGrid
        view={v}
        days={days}
        rows={gridRows(model, days, period)}
        departments={model.departments}
        openShifts={model.openShifts.filter((o) => days.includes(o.date))}
        totals={rosterTotals(model, days)}
        editable={editable}
        onOpenShift={(id) => openShift(id)}
        onAddShift={(code, date) => {
          const staffId = model.staffIdOf(code)
          if (!staffId || date < period.from || date > period.to) return
          open({
            kind: 'add',
            staffId,
            shift: { id: NEW_SHIFT_ID, cashierId: code, date, departmentId: detail.roster.departmentId, startMin: 540, endMin: 1080, activities: [] },
          })
        }}
      />
    )
  }

  const editorCashier = editing ? model.cashiers.find((c) => c.id === editing.shift.cashierId) : undefined
  const staffIdOfEditing = editing ? model.staffIdOf(editing.shift.cashierId) : undefined
  const sortedChanges = [...detail.overrides].reverse()

  return (
    <Stack gap={4}>
      <Cluster gap={3} align="end">
        {rosters.length > 1 && (
          <Field label={f.t('roster.screen.rosterPicker')} className="min-w-64">
            {(aria) => (
              <Select {...aria} value={rosterId} onChange={(e) => setRosterId(e.target.value)}>
                {rosters.map((r) => (
                  <option key={r.id} value={r.id}>
                    {f.t('roster.screen.period', { department: r.departmentName, from: f.day(r.periodStart), to: f.day(r.periodEnd) })}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <h2 className="text-h2 text-text">
          {f.t('roster.screen.period', {
            department: detail.roster.departmentName,
            from: f.day(detail.roster.periodStart),
            to: f.day(detail.roster.periodEnd),
          })}
        </h2>
        {!canOverride && <p className="text-body-sm text-text-muted">{f.t('roster.screen.readOnly')}</p>}
      </Cluster>

      {notice && (
        <Alert tone={notice.tone} title={notice.text} />
      )}

      <RosterZoom view={view} onViewChange={setView} anchor={anchor} onAnchorChange={setAnchor} renderView={renderView} />
      <RosterLegend departments={model.departments} />

      <section aria-labelledby={`${uid}-checks`} className="border-2 border-outline bg-surface p-4">
        <h2 id={`${uid}-checks`} className="text-h3 text-text">
          {f.t('roster.screen.laborChecks')}
        </h2>
        {detail.laborChecks.length === 0 ? (
          <p className="text-body-sm text-text-muted">{f.t('roster.screen.laborChecksNone')}</p>
        ) : (
          <ul className="m-0 list-none p-0 text-body-sm">
            {detail.laborChecks.map((b) => {
              const tone = b.severity === 'block' ? 'danger' : 'warning'
              const Icon = STATUS_META[tone].icon
              return (
                <li key={`${b.rule}|${b.staffId}|${b.date}`} className="flex items-center gap-2 py-0.5 text-text">
                  <Icon aria-hidden="true" className={cn('size-4 shrink-0', STATUS_META[tone].fg)} />
                  <span className="sr-only">{f.t(`roster.editor.rule.${tone}`)}: </span>
                  {breachText(f, b, detail)}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby={`${uid}-changes`} className="border-2 border-outline bg-surface p-4">
        <h2 id={`${uid}-changes`} className="text-h3 text-text">
          {f.t('roster.screen.changes')}
        </h2>
        {sortedChanges.length === 0 ? (
          <p className="text-body-sm text-text-muted">{f.t('roster.screen.changesNone')}</p>
        ) : (
          <ul className="m-0 list-none p-0 text-body-sm">
            {sortedChanges.map((o) => (
              <li key={o.id} className="border-b-2 border-outline-subtle py-1">
                <span aria-hidden="true">✎ </span>
                {f.t('roster.screen.changeBy', { change: f.t(`roster.override.${o.type}`), by: o.by, at: f.dateTime(o.at) })}
                {o.reason && <span className="block text-text-muted">{f.t('roster.screen.changeReason', { reason: o.reason })}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && editorCashier && replacements !== null && (
        <ShiftEditor
          key={`${editing.shift.id}-${editing.shift.startMin}-${editing.shift.endMin}`}
          open
          onOpenChange={(o) => !o && close()}
          cashier={editorCashier}
          shift={editing.shift}
          department={department(editing.shift.departmentId)}
          window={DEFAULT_DAY_WINDOW}
          ruleChecks={draftCheck ? toRuleChecks(f, draftCheck, detail) : []}
          replacements={toReplacements(f, replacements)}
          canEditTimes={!(editing.kind === 'shift' && editing.mobile)}
          allowEmergency={editing.kind === 'shift'}
          {...(editing.kind === 'shift' && !editing.mobile ? { onRemove: (id: string) => void submit({ type: 'remove', shiftId: id }) } : {})}
          onDraftChange={(d) => setPendingDraft(draftRequest(editing, d))}
          onSave={(d) => {
            const change = draftRequest(editing, d)
            void submit(d.reason ? { ...change, reason: d.reason } : change)
          }}
          onEmergencyOff={(c) => {
            if (!staffIdOfEditing) return
            void submit({
              type: 'emergency_off',
              shiftId: c.shiftId,
              replacementStaffId: c.replacementId,
              offReason: c.reason,
              ...(c.overrideReason ? { reason: c.overrideReason } : {}),
            })
          }}
        />
      )}
      {pendingDraft && draftCheck === null && editing && (
        <p className="sr-only" aria-live="polite">
          {f.t('roster.screen.checking')}
        </p>
      )}
    </Stack>
  )
}
