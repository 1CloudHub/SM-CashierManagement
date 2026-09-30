import { cn } from '@/lib/utils'
import { Card } from './card'
import { Skeleton } from './skeleton'
import { STATUS_META, type StatusTone } from './status'

/**
 * KpiCard (SG-006, UX-005 information hierarchy).
 *
 * A headline number with a label above and an optional detail below. The value
 * uses the KPI type token and tabular figures (`lw-numeric`) so columns of
 * numbers align. Pass the value as a node so a Currency/Num component can own
 * the ₱/locale formatting.
 *
 * `emphasis="key"` marks the SINGLE most important number on a screen with a
 * solid fill (SG-006: solid fill is reserved for the one key number / primary
 * action / most urgent status). Use it at most once per view.
 *
 * `tone` optionally tints the value + adds a paired status icon (never colour
 * alone) for KPIs that also signal a state (e.g. a shortfall in danger).
 */
export interface KpiCardProps {
  label: React.ReactNode
  value: React.ReactNode
  detail?: React.ReactNode
  emphasis?: 'default' | 'key'
  tone?: StatusTone
  className?: string
}

export function KpiCard({
  label,
  value,
  detail,
  emphasis = 'default',
  tone,
  className,
}: KpiCardProps) {
  const key = emphasis === 'key'
  const ToneIcon = tone ? STATUS_META[tone].icon : null

  return (
    <Card
      className={cn(
        'flex flex-col gap-1',
        key && 'bg-primary text-on-primary border-primary',
        className,
      )}
    >
      <div
        className={cn(
          'text-label uppercase',
          key ? 'text-on-primary opacity-90' : 'text-text-muted',
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          'lw-numeric text-kpi flex items-center gap-2',
          !key && tone ? STATUS_META[tone].fg : undefined,
        )}
      >
        {ToneIcon && !key && (
          <ToneIcon aria-hidden="true" className="size-6 shrink-0" />
        )}
        {value}
      </div>
      {detail && (
        <div
          className={cn(
            'text-body-sm',
            key ? 'text-on-primary opacity-90' : 'text-text-muted',
          )}
        >
          {detail}
        </div>
      )}
    </Card>
  )
}

/**
 * KpiCardSkeleton — loading variant matching the KpiCard layout exactly (label
 * line, big value line, detail line) so KPI rows don't shift (UX-010).
 */
export function KpiCardSkeleton({
  className,
  label = 'Loading',
}: {
  className?: string
  label?: string
}) {
  return (
    <Card
      className={cn('flex flex-col gap-2', className)}
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">{label}</span>
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-8 w-3/4" />
      <Skeleton className="h-4 w-2/5" />
    </Card>
  )
}
