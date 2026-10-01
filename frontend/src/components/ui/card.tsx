import { cn } from '@/lib/utils'
import { Skeleton, SkeletonText } from './skeleton'

/**
 * Card (SG-006). A surface panel: square corners, 2px outline, no shadow —
 * elevation is surface stepping, not shadow. Compose with CardHeader / body.
 */
export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="card"
      className={cn('border border-outline-subtle bg-surface p-4', className)}
      {...props}
    />
  )
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('mb-3 flex items-start justify-between gap-3', className)}
      {...props}
    />
  )
}

export function CardTitle({
  className,
  as: Comp = 'h2',
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & {
  as?: 'h2' | 'h3' | 'h4'
}) {
  return <Comp className={cn('text-h3 text-text', className)} {...props} />
}

/**
 * CardSkeleton — the loading variant that matches the Card layout so there is
 * no shift when content arrives (UX-010). The region is labelled "Loading" for
 * assistive tech; the shimmer stops under reduced motion.
 */
export function CardSkeleton({
  lines = 3,
  className,
  label = 'Loading',
}: {
  lines?: number
  className?: string
  label?: string
}) {
  return (
    <Card className={className} role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="mb-3 h-5 w-2/5" />
      <SkeletonText lines={lines} />
    </Card>
  )
}
