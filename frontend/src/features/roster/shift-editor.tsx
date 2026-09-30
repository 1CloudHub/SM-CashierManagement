import { useId, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { STATUS_META, type StatusTone } from '@/components/ui/status'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Stack } from '@/components/layout/stack'
import { Cluster } from '@/components/layout/cluster'
import { cn } from '@/lib/utils'
import { DEFAULT_SNAP_MIN, MINUTES_PER_HOUR, paidMinutes } from './model'
import {
  ACTIVITY_KINDS,
  EMERGENCY_REASONS,
  type ActivityKind,
  type EmergencyReason,
  type DayWindow,
  type RosterCashier,
  type RosterDepartment,
  type RosterShift,
  type ShiftActivity,
} from './types'
import { useRosterFormat } from './use-roster-format'

/** A labor-rule check result to show live in the editor (requirement 6.7). */
export interface RuleCheck {
  readonly id: string
  readonly tone: Extract<StatusTone, 'success' | 'warning' | 'danger'>
  readonly text: ReactNode
}

/** A ranked replacement for an emergency off (requirement 7.5). */
export interface Replacement {
  readonly cashierId: string
  /** Already formatted, e.g. "FT-07 · same store · 5 days, 40 h". */
  readonly label: string
  readonly eligible: boolean
}

export interface ShiftEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  cashier: RosterCashier
  shift: RosterShift
  department?: RosterDepartment
  window: DayWindow
  snapMin?: number
  /** Live rule checks for the draft (parent recomputes via `onDraftChange`). */
  ruleChecks?: readonly RuleCheck[]
  replacements?: readonly Replacement[]
  /** False on phones: only the emergency-off tab is usable (req. 24.2). */
  canEditTimes?: boolean
  onDraftChange?: (draft: ShiftDraft) => void
  onSave?: (draft: ShiftDraft) => void
  onEmergencyOff?: (choice: {
    shiftId: string
    replacementId: string | null
    findNearby: boolean
    reason: EmergencyReason
  }) => void
}

export interface ShiftDraft {
  shiftId: string
  startMin: number
  endMin: number
  activities: ShiftActivity[]
}

const DEFAULT_ACTIVITY_MIN: Record<ActivityKind, number> = {
  meal: 60,
  training: 30,
  huddle: 30,
}

const NEARBY = '__nearby__'

/**
 * Shift editor (task 13.1 — requirement 6.6, design.md "Shift editor",
 * wireframe SHIFTPOP). A dialog with two tabs: Edit shift (start/end on the
 * snap grid, activities add/remove, live rule checks) and Emergency off /
 * reassign (ranked replacements incl. "Find cover nearby", reason). Every
 * pointer action on the timeline has its keyboard equivalent here.
 */
export function ShiftEditor({
  open,
  onOpenChange,
  cashier,
  shift,
  department,
  window,
  snapMin = DEFAULT_SNAP_MIN,
  ruleChecks = [],
  replacements = [],
  canEditTimes = true,
  onDraftChange,
  onSave,
  onEmergencyOff,
}: ShiftEditorProps) {
  const f = useRosterFormat()
  const uid = useId()
  const [draft, setDraftState] = useState<ShiftDraft>(() => ({
    shiftId: shift.id,
    startMin: shift.startMin,
    endMin: shift.endMin,
    activities: [...shift.activities],
  }))
  const [newKind, setNewKind] = useState<ActivityKind>('meal')
  const [newStart, setNewStart] = useState(shift.startMin)
  const [replacement, setReplacement] = useState<string>(
    replacements.find((r) => r.eligible)?.cashierId ?? NEARBY,
  )
  const [reason, setReason] = useState<EmergencyReason>('sickCall')

  const setDraft = (next: ShiftDraft) => {
    setDraftState(next)
    onDraftChange?.(next)
  }

  const slots: number[] = []
  for (
    let m = window.startHour * MINUTES_PER_HOUR;
    m <= window.endHour * MINUTES_PER_HOUR;
    m += snapMin
  ) {
    slots.push(m)
  }
  const invalid = draft.endMin <= draft.startMin
  const activityOutside = draft.activities.some(
    (a) => a.startMin < draft.startMin || a.endMin > draft.endMin,
  )

  const addActivity = () => {
    const endMin = Math.min(newStart + DEFAULT_ACTIVITY_MIN[newKind], draft.endMin)
    if (endMin <= newStart) return
    const activities = [...draft.activities, { kind: newKind, startMin: newStart, endMin }].sort(
      (a, b) => a.startMin - b.startMin,
    )
    setDraft({ ...draft, activities })
  }

  const blockingRule = ruleChecks.some((r) => r.tone === 'danger')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {cashier.id} {cashier.name}
          </DialogTitle>
          <DialogDescription>
            {f.t('roster.editor.description', {
              date: f.dayLong(shift.date),
              hours: f.hours(paidMinutes(draft)),
              department: department?.name ?? '',
            })}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue={canEditTimes ? 'edit' : 'emergency'}>
          <TabsList aria-label={f.t('roster.editor.tabsLabel')}>
            <TabsTrigger value="edit" disabled={!canEditTimes}>
              {f.t('roster.editor.tabEdit')}
            </TabsTrigger>
            <TabsTrigger value="emergency">{f.t('roster.editor.tabEmergency')}</TabsTrigger>
          </TabsList>

          <TabsContent value="edit">
            <Stack gap={4}>
              <Cluster gap={3} align="start">
                <Field label={f.t('roster.editor.start')} className="min-w-36 flex-1">
                  {(aria) => (
                    <Select
                      {...aria}
                      value={draft.startMin}
                      onChange={(e) => setDraft({ ...draft, startMin: Number(e.target.value) })}
                    >
                      {slots.slice(0, -1).map((m) => (
                        <option key={m} value={m}>
                          {f.time(m)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field
                  label={f.t('roster.editor.end')}
                  className="min-w-36 flex-1"
                  error={invalid ? f.t('roster.editor.invalidTime') : undefined}
                >
                  {(aria) => (
                    <Select
                      {...aria}
                      invalid={invalid}
                      value={draft.endMin}
                      onChange={(e) => setDraft({ ...draft, endMin: Number(e.target.value) })}
                    >
                      {slots.slice(1).map((m) => (
                        <option key={m} value={m}>
                          {f.time(m)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </Cluster>

              <section aria-labelledby={`${uid}-activities`}>
                <h3 id={`${uid}-activities`} className="text-h3 text-text">
                  {f.t('roster.editor.activities')}
                </h3>
                {draft.activities.length === 0 ? (
                  <p className="text-body-sm text-text-muted">{f.t('roster.editor.noActivities')}</p>
                ) : (
                  <ul className="m-0 list-none p-0">
                    {draft.activities.map((a, i) => (
                      <li
                        key={`${a.kind}-${a.startMin}`}
                        className="flex items-center justify-between gap-2 border-b-2 border-outline-subtle py-1 text-body-sm"
                      >
                        <span>
                          <b className="font-weight-bold">{f.activityLetter(a.kind)}</b>{' '}
                          {f.activityText(a)}
                        </span>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={f.t('roster.editor.removeActivity', {
                            activity: f.activityText(a),
                          })}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              activities: draft.activities.filter((_, j) => j !== i),
                            })
                          }
                        >
                          <X aria-hidden="true" className="size-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                {activityOutside && (
                  <p className="mt-1 text-body-sm text-on-danger-soft">
                    {f.t('roster.editor.activityOutside')}
                  </p>
                )}
                <Cluster gap={2} align="end" className="mt-2">
                  <Field label={f.t('roster.editor.activityKind')} className="min-w-32 flex-1">
                    {(aria) => (
                      <Select
                        {...aria}
                        value={newKind}
                        onChange={(e) => setNewKind(e.target.value as ActivityKind)}
                      >
                        {ACTIVITY_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {f.activity(k)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label={f.t('roster.editor.activityStart')} className="min-w-32 flex-1">
                    {(aria) => (
                      <Select
                        {...aria}
                        value={newStart}
                        onChange={(e) => setNewStart(Number(e.target.value))}
                      >
                        {slots
                          .filter((m) => m >= draft.startMin && m < draft.endMin)
                          .map((m) => (
                            <option key={m} value={m}>
                              {f.time(m)}
                            </option>
                          ))}
                      </Select>
                    )}
                  </Field>
                  <Button size="sm" onClick={addActivity}>
                    {f.t('roster.editor.addActivity')}
                  </Button>
                </Cluster>
              </section>

              {ruleChecks.length > 0 && (
                <section aria-labelledby={`${uid}-rules`} aria-live="polite">
                  <h3 id={`${uid}-rules`} className="text-h3 text-text">
                    {f.t('roster.editor.ruleChecks')}
                  </h3>
                  <ul className="m-0 list-none p-0 text-body-sm">
                    {ruleChecks.map((r) => {
                      const Icon = STATUS_META[r.tone].icon
                      return (
                        <li key={r.id} className="flex items-center gap-2 py-0.5 text-text">
                          <Icon aria-hidden="true" className={cn('size-4 shrink-0', STATUS_META[r.tone].fg)} />
                          <span className="sr-only">{f.t(`roster.editor.rule.${r.tone}`)}: </span>
                          {r.text}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )}

              <p className="text-body-sm text-text-muted">{f.t('roster.editor.hint')}</p>
              <DialogFooter>
                <Button onClick={() => onOpenChange(false)}>{f.t('action.cancel')}</Button>
                <Button
                  variant="primary"
                  disabled={invalid || activityOutside || blockingRule}
                  onClick={() => onSave?.(draft)}
                >
                  {f.t('roster.editor.save')}
                </Button>
              </DialogFooter>
            </Stack>
          </TabsContent>

          <TabsContent value="emergency">
            <Stack gap={4}>
              <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
                <legend className="mb-1 text-label uppercase text-text-muted">
                  {f.t('roster.editor.replacement')}
                </legend>
                {replacements.map((r) => (
                  <label key={r.cashierId} className="flex min-h-tap items-center gap-2 text-body-sm">
                    <input
                      type="radio"
                      name={`${uid}-replacement`}
                      value={r.cashierId}
                      checked={replacement === r.cashierId}
                      onChange={() => setReplacement(r.cashierId)}
                    />
                    <span>
                      {r.label}{' '}
                      <span aria-hidden="true">{r.eligible ? '✓' : '⚠'}</span>
                      <span className="sr-only">
                        {r.eligible ? f.t('roster.editor.eligible') : f.t('roster.editor.breaksRule')}
                      </span>
                    </span>
                  </label>
                ))}
                <label className="flex min-h-tap items-center gap-2 text-body-sm">
                  <input
                    type="radio"
                    name={`${uid}-replacement`}
                    value={NEARBY}
                    checked={replacement === NEARBY}
                    onChange={() => setReplacement(NEARBY)}
                  />
                  {f.t('roster.editor.findNearby')}
                </label>
              </fieldset>
              <Field label={f.t('roster.editor.reason')}>
                {(aria) => (
                  <Select
                    {...aria}
                    value={reason}
                    onChange={(e) => setReason(e.target.value as EmergencyReason)}
                  >
                    {EMERGENCY_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {f.t(`roster.editor.reason.${r}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <DialogFooter>
                <Button onClick={() => onOpenChange(false)}>{f.t('action.cancel')}</Button>
                <Button
                  variant="primary"
                  onClick={() =>
                    onEmergencyOff?.({
                      shiftId: shift.id,
                      replacementId: replacement === NEARBY ? null : replacement,
                      findNearby: replacement === NEARBY,
                      reason,
                    })
                  }
                >
                  {f.t('roster.editor.confirmOff')}
                </Button>
              </DialogFooter>
            </Stack>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
