import type { ReactNode } from 'react'
import type { IsoDate } from '@lanewise/shared'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { Button } from '@/components/ui/button'
import { SegmentedControl, SegmentedItem, Tabs } from '@/components/ui/tabs'
import { Cluster } from '@/components/layout/cluster'
import { Stack } from '@/components/layout/stack'
import { gridDays, stepAnchor } from './model'
import { ROSTER_VIEWS, type RosterView } from './types'
import { useRosterFormat } from './use-roster-format'

export interface RosterZoomProps {
  view: RosterView
  onViewChange: (view: RosterView) => void
  /** The anchor date the navigator shows (the day, or a day in the range). */
  anchor: IsoDate
  onAnchorChange: (anchor: IsoDate) => void
  /** Render the panel for the active view (only the active one mounts). */
  renderView: (view: RosterView) => ReactNode
  /** Extra controls on the navigator row (e.g. Auto-build, Export). */
  actions?: ReactNode
}

/**
 * Zoom switch + date navigator (task 13.2 — requirement 6.1, wireframe
 * SCR-022: ‹ Sat, Dec 19, 2026 ›  [Day | Week | Fortnight | Four weeks |
 * Month]). Tabs semantics (roving arrows between zoom levels); the navigator
 * steps one unit of the active zoom and announces the new range.
 */
export function RosterZoom({
  view,
  onViewChange,
  anchor,
  onAnchorChange,
  renderView,
  actions,
}: RosterZoomProps) {
  const f = useRosterFormat()

  let rangeLabel: string
  if (view === 'day') rangeLabel = f.dayLong(anchor)
  else if (view === 'month') rangeLabel = f.monthYear(anchor)
  else {
    const days = gridDays(anchor, view)
    rangeLabel = f.t('roster.timeRange', {
      start: f.day(days[0]),
      end: f.day(days[days.length - 1]),
    })
  }

  return (
    <Tabs value={view} onValueChange={(v) => onViewChange(v as RosterView)}>
      <Stack gap={4}>
        <Cluster justify="between" gap={3}>
          <div
            role="group"
            aria-label={f.t('roster.nav.label')}
            className="inline-flex items-center gap-1 border-2 border-outline bg-surface px-1"
          >
            <Button
              size="icon"
              variant="ghost"
              aria-label={f.t(`roster.nav.previous.${view}`)}
              onClick={() => onAnchorChange(stepAnchor(anchor, view, -1))}
            >
              <ChevronLeft aria-hidden="true" className="size-5" />
            </Button>
            <b aria-live="polite" className="lw-numeric px-1 text-body font-weight-bold text-text">
              {rangeLabel}
            </b>
            <Button
              size="icon"
              variant="ghost"
              aria-label={f.t(`roster.nav.next.${view}`)}
              onClick={() => onAnchorChange(stepAnchor(anchor, view, 1))}
            >
              <ChevronRight aria-hidden="true" className="size-5" />
            </Button>
          </div>
          <Cluster gap={3}>
            <SegmentedControl aria-label={f.t('roster.zoom.label')}>
              {ROSTER_VIEWS.map((v) => (
                <SegmentedItem key={v} value={v}>
                  {f.t(`roster.view.${v}`)}
                </SegmentedItem>
              ))}
            </SegmentedControl>
            {actions}
          </Cluster>
        </Cluster>
        {ROSTER_VIEWS.map((v) => (
          <TabsPrimitive.Content
            key={v}
            value={v}
            className="focus-visible:outline-focus-ring"
          >
            {v === view && renderView(v)}
          </TabsPrimitive.Content>
        ))}
      </Stack>
    </Tabs>
  )
}
