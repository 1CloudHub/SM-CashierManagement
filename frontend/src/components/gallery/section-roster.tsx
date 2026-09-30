import { useState } from 'react'
import type { IsoDate } from '@lanewise/shared'
import { Section } from '@/components/layout/section'
import { Stack } from '@/components/layout/stack'
import {
  DayTimeline,
  MobileDayList,
  MobileWeekList,
  MonthCoverage,
  MyRoster,
  RosterGrid,
  RosterLegend,
  RosterZoom,
  ShiftEditor,
  gridDays,
  type DayTimelineRow,
  type RosterView,
} from '@/features/roster'
import {
  SAMPLE_DATE,
  SAMPLE_DAY_ROWS,
  SAMPLE_DEPARTMENTS,
  SAMPLE_MONTH,
  SAMPLE_MY_LATEST_CHANGE,
  SAMPLE_MY_WEEKS,
  SAMPLE_OPEN_SHIFTS,
  SAMPLE_REQUIREMENTS,
  SAMPLE_TOTALS,
  SAMPLE_WEEK_DAYS,
  sampleGridRows,
} from '@/features/roster/fixtures'
import { DEFAULT_DAY_WINDOW } from '@/features/roster/model'
import { Subsection } from './gallery-parts'

/**
 * Roster visual planning — the task 13.1–13.3 components with the SCR-022 /
 * SCR-025 sample data (SM Supermarket – QC, Main checkout lanes, Sat Dec 19,
 * 2026). The planner demo holds its own state so drag, keyboard edits, bulk
 * selection, the shift editor and the zoom switch are all exercisable; the
 * real screen wires the same callbacks to the API (task 13.4).
 */
export function RosterSection() {
  return (
    <Stack gap={8}>
      <Subsection
        title="Roster planner — zoom, Day timeline, Week grid, Month coverage"
        hint="Drag bars or use the keyboard (arrows, Page Up/Down, Shift+arrows, Enter, Space). Tick rows for the bulk bar. Month tiles open the Day view."
      >
        <PlannerDemo />
      </Subsection>
      <Subsection
        title="Phone — Day as a list per cashier"
        hint="Read-only except Emergency off / reassign (store manager)."
      >
        <div className="max-w-sm">
          <MobileDayList
            date={SAMPLE_DATE}
            rows={SAMPLE_DAY_ROWS}
            departments={SAMPLE_DEPARTMENTS}
            onEmergencyOff={() => {}}
          />
        </div>
      </Subsection>
      <Subsection title="Phone — Week as a list per day">
        <div className="max-w-sm">
          <MobileWeekList
            days={SAMPLE_WEEK_DAYS.slice(3, 6)}
            rows={sampleGridRows(SAMPLE_WEEK_DAYS)}
            departments={SAMPLE_DEPARTMENTS}
            openShifts={SAMPLE_OPEN_SHIFTS}
            onEmergencyOff={() => {}}
          />
        </div>
      </Subsection>
      <Subsection title="Staff — My roster (SCR-025)" hint="Own shifts only; no other names or costs.">
        <div className="max-w-sm">
          <MyRoster
            heading="Maria Santos (PT-02) · SM Supermarket – Quezon City · Main checkout lanes"
            weeks={SAMPLE_MY_WEEKS}
            departments={SAMPLE_DEPARTMENTS}
            latestChange={SAMPLE_MY_LATEST_CHANGE}
            onAddToCalendar={() => {}}
          />
        </div>
      </Subsection>
    </Stack>
  )
}

function PlannerDemo() {
  const [view, setView] = useState<RosterView>('day')
  const [anchor, setAnchor] = useState<IsoDate>(SAMPLE_DATE)
  const [rows, setRows] = useState<readonly DayTimelineRow[]>(SAMPLE_DAY_ROWS)
  const [editing, setEditing] = useState<string | null>(null)
  const editingRow = rows.find((r) => r.shift?.id === editing)

  const patchShift = (id: string, patch: Partial<NonNullable<DayTimelineRow['shift']>>) =>
    setRows((prev) =>
      prev.map((r) => (r.shift?.id === id ? { ...r, shift: { ...r.shift, ...patch } } : r)),
    )

  return (
    <>
      <RosterZoom
        view={view}
        onViewChange={setView}
        anchor={anchor}
        onAnchorChange={setAnchor}
        renderView={(v) => {
          if (v === 'day') {
            return (
              <Stack gap={3}>
                <RosterLegend departments={SAMPLE_DEPARTMENTS} />
                <DayTimeline
                  date={anchor}
                  rows={anchor === SAMPLE_DATE ? rows : []}
                  departments={SAMPLE_DEPARTMENTS}
                  requirements={SAMPLE_REQUIREMENTS}
                  editable
                  onShiftChange={({ shiftId, startMin, endMin }) =>
                    patchShift(shiftId, { startMin, endMin })
                  }
                  onOpenShift={setEditing}
                  onBulkAction={() => {}}
                />
              </Stack>
            )
          }
          if (v === 'month') {
            return (
              <MonthCoverage
                month={anchor}
                days={SAMPLE_MONTH}
                onOpenDay={(date) => {
                  setAnchor(date)
                  setView('day')
                }}
              />
            )
          }
          const days = gridDays(anchor, v)
          return (
            <RosterGrid
              view={v}
              days={days}
              rows={sampleGridRows(days)}
              departments={SAMPLE_DEPARTMENTS}
              openShifts={SAMPLE_OPEN_SHIFTS}
              totals={SAMPLE_TOTALS}
              editable
              onAddShift={() => {}}
              onOpenShift={setEditing}
            />
          )
        }}
      />
      {editingRow?.shift && (
        <ShiftEditor
          key={editingRow.shift.id}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          cashier={editingRow.cashier}
          shift={editingRow.shift}
          department={SAMPLE_DEPARTMENTS.find((d) => d.id === editingRow.shift?.departmentId)}
          window={DEFAULT_DAY_WINDOW}
          ruleChecks={[
            { id: 'rest', tone: 'success', text: 'Rest ≥ 10 h' },
            { id: 'days', tone: 'success', text: '5 days this week' },
            { id: 'hours', tone: 'warning', text: '32 h (PT limit 30 h — reason required)' },
          ]}
          replacements={[
            { cashierId: 'FT-07', label: 'FT-07 · same store · 5 days, 40 h', eligible: true },
            { cashierId: 'PT-05', label: 'PT-05 · same store · would exceed 30 h', eligible: false },
          ]}
          onSave={(d) => {
            patchShift(d.shiftId, { startMin: d.startMin, endMin: d.endMin, activities: d.activities })
            setEditing(null)
          }}
          onEmergencyOff={() => setEditing(null)}
        />
      )}
    </>
  )
}

export function RosterGallerySection({ description }: { description: string }) {
  return (
    <Section id="roster" title="Roster" description={description}>
      <RosterSection />
    </Section>
  )
}
