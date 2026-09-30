import { cn } from '@/lib/utils'

/**
 * Skeleton — the loading placeholder primitive (UX-010).
 *
 * Skeletons match the final layout so nothing shifts when real content lands.
 * The shimmer is the only sanctioned looping motion and it stops under
 * prefers-reduced-motion (handled in motion.css: `.motion-skeleton` becomes a
 * static fill). Skeletons are decorative, so they are hidden from assistive
 * tech — the surrounding region carries the "Loading" text (see StateBlock /
 * the loading variants of KpiCard, DataTable, Card).
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      data-slot="skeleton"
      className={cn('motion-skeleton bg-outline-subtle', className)}
      {...props}
    />
  )
}

/**
 * SkeletonText — a run of skeleton lines sized to the type scale, for card
 * bodies and list rows. The last line is shortened so it reads as text.
 */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn('h-4', i === lines - 1 ? 'w-3/5' : 'w-full')}
        />
      ))}
    </div>
  )
}
