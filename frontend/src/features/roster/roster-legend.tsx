import { Cluster } from '@/components/layout/cluster'
import { cn } from '@/lib/utils'
import { catStyle } from './category'
import { ACTIVITY_KINDS, type RosterDepartment } from './types'
import { useRosterFormat } from './use-roster-format'

const ACT_CLASS = {
  meal: 'lw-act-meal',
  training: 'lw-act-training',
  huddle: 'lw-act-huddle',
} as const

/**
 * The roster legend (wireframe LEG): department swatches, float hatch,
 * activity letters, the ✎ manager-change marker and the delta chip reading.
 * Every swatch is paired with its text, so the legend itself never relies on
 * colour alone.
 */
export function RosterLegend({
  departments,
  className,
}: {
  departments: readonly RosterDepartment[]
  className?: string
}) {
  const f = useRosterFormat()
  const swatch = 'inline-block h-3 w-4 shrink-0'
  return (
    <Cluster
      as="ul"
      gap={4}
      aria-label={f.t('roster.legend.label')}
      className={cn('m-0 list-none p-0 text-body-sm text-text', className)}
    >
      {departments.map((d) => (
        <li key={d.id} className="flex items-center gap-2">
          <span aria-hidden="true" className={cn(swatch, 'lw-cat-swatch')} style={catStyle(d.viz)} />
          {d.shortName}
        </li>
      ))}
      <li className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(swatch, 'lw-cat-swatch lw-hatch-float')}
          style={catStyle(5)}
        />
        {f.contract('float')}
      </li>
      {ACTIVITY_KINDS.map((k) => (
        <li key={k} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(swatch, ACT_CLASS[k], 'grid place-items-center text-caption font-weight-bold')}
          />
          <span>
            <b className="font-weight-bold">{f.activityLetter(k)}</b> {f.activity(k)}
          </span>
        </li>
      ))}
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className={cn(swatch, 'lw-edited')} />
        <span>
          <span aria-hidden="true">✎ </span>
          {f.t('roster.legend.edited')}
        </span>
      </li>
      <li className="flex items-center gap-2">
        <span className="border border-danger bg-danger px-1 text-caption font-weight-bold text-on-danger">
          {f.signed(-2)}
        </span>
        {f.t('roster.legend.short')}
        <span className="border border-warning px-1 text-caption font-weight-bold text-text">
          {f.signed(1)}
        </span>
        {f.t('roster.legend.surplus')}
      </li>
    </Cluster>
  )
}
