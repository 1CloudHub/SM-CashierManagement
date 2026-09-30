import { cn } from '@/lib/utils'
import { Skeleton } from './skeleton'

/**
 * MediaPlaceholder (UX-010) — the LABELLED loading placeholder for regions that
 * can't be skeleton-mimicked cell-for-cell: charts, the roster timeline and the
 * map. Unlike a skeleton it keeps a visible, announced label ("Loading chart…")
 * so the wait is explained, while still reserving the final region size so
 * nothing shifts. Every chart also ships a table alternative elsewhere; this is
 * only the loading affordance.
 */
export function MediaPlaceholder({
  label,
  className,
  minHeightClass = 'min-h-48',
}: {
  label: string
  className?: string
  minHeightClass?: string
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-col items-center justify-center gap-3 border-2 border-outline-subtle bg-surface-2 p-6',
        minHeightClass,
        className,
      )}
    >
      <Skeleton className="h-24 w-full max-w-md" />
      <p className="text-body-sm text-text-muted">{label}</p>
    </div>
  )
}
