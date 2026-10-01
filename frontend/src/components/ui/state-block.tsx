import { Ban, CircleAlert, Inbox, WifiOff, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * StateBlock (UX-010) — the shared, centred region state for the non-loading
 * "there is nothing to show right now" cases:
 *
 *   - empty:     "No published plan for this season yet." + next step
 *   - error:     inline message + retry + a reference id
 *   - no-access: "You don't have access to this store." — reveals nothing,
 *                shows NO partial data
 *   - offline:   client cannot reach the API — Retry, keeps local drafts
 *
 * Every variant explains why and offers a clear way forward (an action slot).
 * Errors announce assertively; the rest are polite. Screens render this in the
 * content region so they never re-implement empty/error/no-access markup.
 */
export type StateVariant = 'empty' | 'error' | 'no-access' | 'offline'

const VARIANT_ICON: Record<StateVariant, LucideIcon> = {
  empty: Inbox,
  error: CircleAlert,
  'no-access': Ban,
  offline: WifiOff,
}

export interface StateBlockProps {
  variant?: StateVariant
  title: React.ReactNode
  description?: React.ReactNode
  /** Primary/secondary actions, e.g. a Retry button or an "Open scenarios" link. */
  action?: React.ReactNode
  /** Reference id for support (error/offline). */
  referenceId?: string
  className?: string
}

export function StateBlock({
  variant = 'empty',
  title,
  description,
  action,
  referenceId,
  className,
}: StateBlockProps) {
  const Icon = VARIANT_ICON[variant]
  const isError = variant === 'error' || variant === 'offline'
  const tone =
    variant === 'error'
      ? 'text-danger'
      : variant === 'no-access'
        ? 'text-warning'
        : 'text-text-muted'

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      className={cn(
        'flex flex-col items-center gap-3 border border-outline bg-surface px-6 py-12 text-center',
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn('size-8', tone)} />
      <h2 className="text-h2 text-text">{title}</h2>
      {description && (
        <p className="max-w-prose text-body text-text-muted">{description}</p>
      )}
      {referenceId && (
        <p className="text-body-sm text-text-muted">
          Reference ID:{' '}
          <span className="lw-numeric font-weight-semibold">{referenceId}</span>
        </p>
      )}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-3">{action}</div>}
    </div>
  )
}
