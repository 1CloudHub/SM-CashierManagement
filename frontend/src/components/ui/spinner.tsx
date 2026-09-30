import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Spinner — a small busy indicator (UX-010).
 *
 * Per the states model a spinner is only for SHORT waits and is DEFERRED so it
 * never flashes: it appears after `delayMs`. Longer / layout-bearing waits use
 * skeletons instead. The spin stops under prefers-reduced-motion (the token
 * durations collapse to 0), but the label still announces "Loading".
 */
export function Spinner({
  label = 'Loading',
  delayMs = 400,
  className,
  size = 'md',
}: {
  label?: string
  delayMs?: number
  className?: string
  size?: 'sm' | 'md'
}) {
  const [shown, setShown] = useState(delayMs === 0)

  useEffect(() => {
    if (delayMs === 0) return
    const t = window.setTimeout(() => setShown(true), delayMs)
    return () => window.clearTimeout(t)
  }, [delayMs])

  if (!shown) return null

  return (
    <span
      role="status"
      aria-live="polite"
      className={cn('inline-flex items-center gap-2 text-text-muted', className)}
    >
      <Loader2
        aria-hidden="true"
        className={cn(
          'motion-safe:animate-spin',
          size === 'sm' ? 'size-4' : 'size-5',
        )}
      />
      <span className="text-body-sm">{label}</span>
    </span>
  )
}
