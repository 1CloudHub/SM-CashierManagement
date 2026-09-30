import {
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import type { IsoDate } from '@lanewise/shared'
import { Table2, ChartGantt } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Cluster } from '@/components/layout/cluster'
import { Stack } from '@/components/layout/stack'
import { cn } from '@/lib/utils'
import { BulkBar } from './bulk-bar'
import { catStyle } from './category'
import { DayTimelineTable } from './day-timeline-table'
import {
  DEFAULT_DAY_WINDOW,
  DEFAULT_SNAP_MIN,
  MINUTES_PER_HOUR,
  hourlyDeltas,
  moveShift,
  resizeShift,
  windowHours,
} from './model'
import type {
  BulkAction,
  DayTimelineRow,
  DayWindow,
  HourRequirement,
  RosterDepartment,
  RosterShift,
  ShiftTimeChange,
} from './types'
import { useRosterFormat } from './use-roster-format'
import './roster.css'

export interface DayTimelineProps {
  date: IsoDate
  rows: readonly DayTimelineRow[]
  departments: readonly RosterDepartment[]
  /** Required cashiers on lanes per hour (Erlang C). */
  requirements: readonly HourRequirement[]
  /** Visible hours; defaults to 7 AM – 11 PM. */
  window?: DayWindow
  /** Allow selection, drag/resize and keyboard edits. */
  editable?: boolean
  /** Snap for drag and arrow-key edits (minutes). Default 15. */
  snapMin?: number
  /** Controlled selection; omit to let the timeline hold it. */
  selectedShiftIds?: readonly string[]
  onSelectionChange?: (shiftIds: string[]) => void
  /** A drag or keyboard move/resize the parent should apply. */
  onShiftChange?: (change: ShiftTimeChange) => void
  /** Open the shift editor (click / Enter). */
  onOpenShift?: (shiftId: string) => void
  onBulkAction?: (action: BulkAction, shiftIds: string[]) => void
  /** Start in the table alternative instead of the timeline. */
  defaultMode?: 'timeline' | 'table'
}

type DragKind = 'move' | 'start' | 'end'
interface Drag {
  shiftId: string
  kind: DragKind
  originX: number
  trackWidth: number
  from: { startMin: number; endMin: number }
  preview: { startMin: number; endMin: number }
  moved: boolean
}

const ACT_CLASS = {
  meal: 'lw-act-meal',
  training: 'lw-act-training',
  huddle: 'lw-act-huddle',
} as const

/**
 * Day timeline (task 13.1 — requirement 6.2, design.md "Visual planning
 * components", wireframe SCR-022 Day view / SCR-021 shift builder).
 *
 * One row per cashier with the shift bar coloured by department (plus its
 * name in the accessible label and legend), activity segments (M/T/H), a
 * staffing-versus-need strip above and the required-on-lanes row below.
 * Day-off and unavailable rows show a labelled band; manager changes show ✎.
 *
 * Keyboard (roving focus across shift bars — one Tab stop):
 *   ↑/↓ Home/End  move between shifts        Enter  open the shift editor
 *   ←/→           move by the snap (15 min)  PgUp/PgDn  move by an hour
 *   Shift+←/→     change the end time         Space  select for bulk actions
 * Pointer: drag a bar to move it, drag its edges to resize (snapped).
 *
 * Presentational: the parent owns the roster and applies `onShiftChange`.
 */
export function DayTimeline({
  date,
  rows,
  departments,
  requirements,
  window = DEFAULT_DAY_WINDOW,
  editable = false,
  snapMin = DEFAULT_SNAP_MIN,
  selectedShiftIds,
  onSelectionChange,
  onShiftChange,
  onOpenShift,
  onBulkAction,
  defaultMode = 'timeline',
}: DayTimelineProps) {
  const f = useRosterFormat()
  const uid = useId()
  const [mode, setMode] = useState(defaultMode)
  const [innerSelected, setInnerSelected] = useState<string[]>([])
  const selected = selectedShiftIds ?? innerSelected
  const [drag, setDrag] = useState<Drag | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const barRefs = useRef(new Map<string, HTMLButtonElement>())
  const suppressClick = useRef(false)

  const dept = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments])
  const hours = windowHours(window)
  const spanMin = (window.endHour - window.startHour) * MINUTES_PER_HOUR
  const pct = (min: number) => ((min - window.startHour * MINUTES_PER_HOUR) / spanMin) * 100

  // Apply the in-flight drag preview so bars and the delta strip move live.
  const liveRows = useMemo(
    () =>
      rows.map((r) =>
        r.shift && drag && r.shift.id === drag.shiftId
          ? { ...r, shift: { ...r.shift, ...drag.preview } }
          : r,
      ),
    [rows, drag],
  )
  const shifts = liveRows.flatMap((r) => (r.shift ? [r.shift] : []))
  const deltas = hourlyDeltas(shifts, requirements, window)
  const maxRequired = Math.max(1, ...requirements.map((r) => r.required))
  const shiftIds = shifts.map((s) => s.id)
  const focusId = activeId && shiftIds.includes(activeId) ? activeId : shiftIds[0]

  const setSelected = (next: string[]) => {
    if (!selectedShiftIds) setInnerSelected(next)
    onSelectionChange?.(next)
  }
  const toggle = (id: string) =>
    setSelected(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id])
  const allSelected = shiftIds.length > 0 && shiftIds.every((id) => selected.includes(id))
  const someSelected = !allSelected && shiftIds.some((id) => selected.includes(id))

  const cashierFor = (shiftId: string) => rows.find((r) => r.shift?.id === shiftId)?.cashier

  const commit = (shift: RosterShift, next: { startMin: number; endMin: number }) => {
    if (next.startMin === shift.startMin && next.endMin === shift.endMin) return
    onShiftChange?.({ shiftId: shift.id, ...next })
    const cashier = cashierFor(shift.id)
    setAnnouncement(
      f.t('roster.announce.changed', {
        cashier: cashier ? `${cashier.id} ${cashier.name}` : '',
        time: f.range(next.startMin, next.endMin),
      }),
    )
  }

  const focusShift = (id: string | undefined) => {
    if (!id) return
    setActiveId(id)
    barRefs.current.get(id)?.focus()
  }

  const onBarKeyDown = (shift: RosterShift, e: KeyboardEvent<HTMLButtonElement>) => {
    const i = shiftIds.indexOf(shift.id)
    const edit = (next: { startMin: number; endMin: number }) => {
      e.preventDefault()
      if (editable) commit(shift, next)
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        return focusShift(shiftIds[Math.min(shiftIds.length - 1, i + 1)])
      case 'ArrowUp':
        e.preventDefault()
        return focusShift(shiftIds[Math.max(0, i - 1)])
      case 'Home':
        e.preventDefault()
        return focusShift(shiftIds[0])
      case 'End':
        e.preventDefault()
        return focusShift(shiftIds[shiftIds.length - 1])
      case ' ':
        e.preventDefault()
        if (editable) toggle(shift.id)
        return
      case 'ArrowLeft':
      case 'ArrowRight': {
        const dir = e.key === 'ArrowLeft' ? -1 : 1
        return edit(
          e.shiftKey
            ? resizeShift(shift, 'end', dir * snapMin, window, snapMin)
            : moveShift(shift, dir * snapMin, window, snapMin),
        )
      }
      case 'PageUp':
      case 'PageDown': {
        const dir = e.key === 'PageUp' ? -1 : 1
        return edit(
          e.shiftKey
            ? resizeShift(shift, 'end', dir * MINUTES_PER_HOUR, window, snapMin)
            : moveShift(shift, dir * MINUTES_PER_HOUR, window, snapMin),
        )
      }
    }
  }

  const startDrag = (shift: RosterShift, kind: DragKind, e: PointerEvent<HTMLElement>) => {
    if (!editable || e.button !== 0) return
    const track = (e.currentTarget as HTMLElement).closest('[data-track]')
    const width = track?.getBoundingClientRect().width ?? 0
    if (!width) return
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    const from = { startMin: shift.startMin, endMin: shift.endMin }
    setDrag({ shiftId: shift.id, kind, originX: e.clientX, trackWidth: width, from, preview: from, moved: false })
  }

  const onDragMove = (e: PointerEvent<HTMLElement>) => {
    if (!drag) return
    const deltaMin = ((e.clientX - drag.originX) / drag.trackWidth) * spanMin
    const preview =
      drag.kind === 'move'
        ? moveShift(drag.from, deltaMin, window, snapMin)
        : resizeShift(drag.from, drag.kind, deltaMin, window, snapMin)
    const moved =
      drag.moved || preview.startMin !== drag.from.startMin || preview.endMin !== drag.from.endMin
    setDrag({ ...drag, preview, moved })
  }

  const endDrag = () => {
    if (!drag) return
    const shift = rows.find((r) => r.shift?.id === drag.shiftId)?.shift
    if (drag.moved) suppressClick.current = true
    if (shift) commit(shift, drag.preview)
    setDrag(null)
  }

  const instructionsId = `${uid}-instructions`
  const cols = { '--cols': hours.length } as CSSProperties
  const metaCol = 'flex min-w-0 items-center gap-2 px-2 py-1 text-body-sm'
  const rowGrid = 'grid grid-cols-[15rem_1fr]'

  return (
    <Stack gap={3}>
      <Cluster justify="between" gap={3}>
        <p id={instructionsId} className="max-w-prose text-body-sm text-text-muted">
          {editable
            ? f.t('roster.timeline.instructions', { step: f.num(snapMin) })
            : f.t('roster.timeline.readOnlyInstructions')}
        </p>
        <Button
          size="sm"
          aria-pressed={mode === 'table'}
          onClick={() => setMode(mode === 'table' ? 'timeline' : 'table')}
        >
          {mode === 'table' ? (
            <ChartGantt aria-hidden="true" className="size-4" />
          ) : (
            <Table2 aria-hidden="true" className="size-4" />
          )}
          {mode === 'table' ? f.t('roster.view.asTimeline') : f.t('roster.view.asTable')}
        </Button>
      </Cluster>

      {mode === 'table' ? (
        <DayTimelineTable
          date={date}
          rows={rows}
          departments={departments}
          deltas={deltas}
          onOpenShift={onOpenShift}
        />
      ) : (
        <div
          role="region"
          aria-label={f.t('roster.timeline.label', { date: f.dayLong(date) })}
          aria-describedby={instructionsId}
          className="overflow-x-auto border-2 border-outline bg-surface"
        >
          <div className="min-w-[60rem]" style={cols}>
            {/* Hour header (visual only — each bar's name carries its times). */}
            <div className={cn(rowGrid, 'sticky top-0 z-10 min-h-8 border-b-2 border-outline bg-surface')}>
              <div className={metaCol}>
                {editable && (
                  <label className="grid min-h-tap min-w-tap place-items-center">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected
                      }}
                      onChange={() => setSelected(allSelected ? [] : shiftIds)}
                      aria-label={f.t('roster.select.all')}
                    />
                  </label>
                )}
                <b className="font-weight-bold">{f.t('roster.timeline.cashier')}</b>
                <span className="ml-auto text-text-muted">{f.t('roster.timeline.skills')}</span>
              </div>
              <div aria-hidden="true" className="lw-track-grid relative">
                {hours.map((h) => (
                  <span
                    key={h}
                    className="absolute top-2 translate-x-1 text-caption text-text-muted"
                    style={{ left: `${pct(h * MINUTES_PER_HOUR)}%` }}
                  >
                    {f.hour(h)}
                  </span>
                ))}
              </div>
            </div>

            {/* Staffing vs need strip (−n short, +n surplus). */}
            <div className={cn(rowGrid, 'min-h-8')}>
              <div className={metaCol}>
                <b className="font-weight-bold">{f.t('roster.timeline.deltaRow')}</b>
                <span className="text-text-muted">{f.t('roster.timeline.deltaHint')}</span>
              </div>
              <ol
                aria-label={f.t('roster.timeline.deltaRow')}
                className="lw-track-grid relative m-0 list-none p-0"
              >
                {deltas.map((d) => (
                  <li
                    key={d.hour}
                    data-hour={d.hour}
                    data-delta={d.delta}
                    className="absolute inset-y-1 grid place-items-center"
                    style={{ left: `${pct(d.hour * MINUTES_PER_HOUR)}%`, width: `${100 / hours.length}%` }}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'lw-numeric border-2 px-1 text-caption font-weight-bold',
                        d.delta < 0 && 'border-danger bg-danger text-on-danger',
                        d.delta > 0 && 'border-warning text-text',
                        d.delta === 0 && 'border-outline-subtle text-text-muted',
                      )}
                    >
                      {f.signed(d.delta)}
                    </span>
                    <span className="sr-only">
                      {f.t('roster.delta.item', {
                        hour: f.hour(d.hour),
                        delta: f.signed(d.delta),
                        word: f.deltaWord(d.delta),
                        rostered: f.num(d.rostered),
                        required: f.num(d.required),
                      })}
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            {liveRows.map(({ cashier, shift, absence }, idx) => {
              const d = shift ? dept.get(shift.departmentId) : undefined
              const isSelected = shift ? selected.includes(shift.id) : false
              const dragging = drag?.shiftId === shift?.id
              return (
                <div
                  key={cashier.id}
                  className={cn(rowGrid, 'min-h-14', idx % 2 === 0 && 'bg-surface-2')}
                >
                  <div className={metaCol}>
                    {editable &&
                      (shift ? (
                        <label className="grid min-h-tap min-w-tap shrink-0 place-items-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggle(shift.id)}
                            aria-label={f.t('roster.select.row', { cashier: `${cashier.id} ${cashier.name}` })}
                          />
                        </label>
                      ) : (
                        <span className="min-w-tap shrink-0" />
                      ))}
                    <span
                      aria-hidden="true"
                      className="grid size-7 shrink-0 place-items-center bg-primary-soft text-caption font-weight-bold text-on-primary-soft"
                    >
                      {cashier.id.slice(0, 2)}
                    </span>
                    <span className="min-w-0">
                      <b className="font-weight-bold">{cashier.id}</b> {cashier.name}
                      <span className="block truncate text-caption text-text-muted">
                        {f.cashierDetail(cashier)}
                      </span>
                    </span>
                    <span className="ml-auto flex shrink-0 flex-wrap justify-end gap-0.5">
                      {cashier.skills.map((s) => (
                        <span
                          key={s}
                          className="border-2 border-outline-subtle px-1 text-caption font-weight-semibold text-text-muted"
                        >
                          {dept.get(s)?.letter ?? s}
                          <span className="sr-only"> {dept.get(s)?.name}</span>
                        </span>
                      ))}
                    </span>
                  </div>

                  <div data-track className="lw-track-grid relative">
                    {absence && (
                      <span
                        className={cn(
                          'absolute inset-x-0 inset-y-2 grid place-items-center bg-surface-2 text-caption text-text-muted',
                          absence === 'unavailable' && 'lw-hatch-unavailable',
                        )}
                      >
                        {f.absence(absence)}
                      </span>
                    )}
                    {shift && (
                      <>
                        <button
                          type="button"
                          ref={(el) => {
                            if (el) barRefs.current.set(shift.id, el)
                            else barRefs.current.delete(shift.id)
                          }}
                          tabIndex={shift.id === focusId ? 0 : -1}
                          data-shift-id={shift.id}
                          aria-label={f.shiftLabel(cashier, shift, d, { selected: isSelected })}
                          aria-describedby={instructionsId}
                          style={{
                            ...catStyle(d?.viz ?? 5),
                            left: `${pct(shift.startMin)}%`,
                            width: `${((shift.endMin - shift.startMin) / spanMin) * 100}%`,
                          }}
                          className={cn(
                            'lw-cat-fill absolute inset-y-1.5 overflow-hidden px-2 text-left text-caption font-weight-semibold whitespace-nowrap motion-interactive',
                            editable ? 'lw-drag cursor-grab' : 'cursor-pointer',
                            dragging && 'cursor-grabbing',
                            cashier.contract === 'float' && 'lw-hatch-float',
                            shift.edited && 'lw-edited',
                            isSelected && 'outline-2 outline-offset-2 outline-primary',
                          )}
                          onFocus={() => setActiveId(shift.id)}
                          onKeyDown={(e) => onBarKeyDown(shift, e)}
                          onKeyUp={(e) => {
                            if (e.key === ' ') e.preventDefault()
                          }}
                          onClick={() => {
                            if (suppressClick.current) {
                              suppressClick.current = false
                              return
                            }
                            onOpenShift?.(shift.id)
                          }}
                          onPointerDown={(e) => startDrag(shift, 'move', e)}
                          onPointerMove={onDragMove}
                          onPointerUp={endDrag}
                          onPointerCancel={() => setDrag(null)}
                        >
                          {isSelected && <span aria-hidden="true">✓ </span>}
                          <span className="lw-numeric">{f.range(shift.startMin, shift.endMin)}</span>
                          {shift.edited && <span aria-hidden="true"> ✎</span>}
                        </button>
                        {shift.activities.map((a) => (
                          <span
                            key={`${a.kind}-${a.startMin}`}
                            aria-hidden="true"
                            className={cn(
                              'pointer-events-none absolute inset-y-1.5 grid place-items-center text-caption font-weight-bold',
                              ACT_CLASS[a.kind],
                            )}
                            style={{
                              left: `${pct(a.startMin)}%`,
                              width: `${((a.endMin - a.startMin) / spanMin) * 100}%`,
                            }}
                          >
                            {f.activityLetter(a.kind)}
                          </span>
                        ))}
                        {editable &&
                          (['start', 'end'] as const).map((edge) => (
                            <span
                              key={edge}
                              aria-hidden="true"
                              data-resize={edge}
                              className="lw-resize-handle absolute inset-y-1.5 w-2"
                              style={{
                                left: `calc(${pct(edge === 'start' ? shift.startMin : shift.endMin)}% - var(--lw-space-1))`,
                              }}
                              onPointerDown={(e) => startDrag(shift, edge, e)}
                              onPointerMove={onDragMove}
                              onPointerUp={endDrag}
                              onPointerCancel={() => setDrag(null)}
                            />
                          ))}
                      </>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Required on lanes (Erlang C) — bar height + the value as text. */}
            <div className={cn(rowGrid, 'min-h-12 border-t-2 border-outline')}>
              <div className={metaCol}>
                <b className="font-weight-bold">{f.t('roster.timeline.coverageRow')}</b>
                <span className="text-text-muted">{f.t('roster.timeline.coverageHint')}</span>
              </div>
              <ol
                aria-label={f.t('roster.timeline.coverageRow')}
                className="lw-track-grid relative m-0 list-none p-0"
              >
                {requirements
                  .filter((r) => r.hour >= window.startHour && r.hour < window.endHour)
                  .map((r) => (
                    <li
                      key={r.hour}
                      className="absolute bottom-1 flex flex-col items-center justify-end"
                      style={{
                        left: `${pct(r.hour * MINUTES_PER_HOUR)}%`,
                        width: `${100 / hours.length}%`,
                        top: 0,
                      }}
                    >
                      <span aria-hidden="true" className="lw-numeric text-caption text-text">
                        {f.num(r.required)}
                      </span>
                      <span
                        aria-hidden="true"
                        className="w-[calc(100%-var(--lw-space-2))] border-t-2 border-primary bg-primary-soft"
                        style={{ height: `${(r.required / maxRequired) * 60}%` }}
                      />
                      <span className="sr-only">
                        {f.t('roster.coverage.item', { hour: f.hour(r.hour), count: f.num(r.required) })}
                      </span>
                    </li>
                  ))}
              </ol>
            </div>
          </div>
        </div>
      )}

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {editable && (
        <BulkBar
          count={selected.length}
          onClear={() => setSelected([])}
          onAction={(a) => onBulkAction?.(a, [...selected])}
        />
      )}
    </Stack>
  )
}
