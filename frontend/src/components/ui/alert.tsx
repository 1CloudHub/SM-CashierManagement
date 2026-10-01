import { cn } from '@/lib/utils'
import { STATUS_META, type StatusTone } from './status'

/**
 * Alert / Banner (SG-006, UX-010).
 *
 * An inline message block that always pairs an icon + text + colour (status is
 * never colour alone). Used for the Stale banner (tone="info" with a
 * Recalculate action), inline error messages (tone="danger" with retry + a
 * reference id), and general notices. Square corners, 2px outline in the tone
 * colour, soft fill.
 *
 * `assertive` raises the live-region politeness to `assertive` for errors that
 * interrupt; otherwise it is polite. Static banners (no live update) pass
 * `live={false}`.
 */
export interface AlertProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: StatusTone
  /** Bold heading line; a node so it can carry inline markup. */
  title?: React.ReactNode
  /** Action slot, e.g. a "Recalculate" or "Try again" button. */
  action?: React.ReactNode
  /** Reference id for support (error state). */
  referenceId?: string
  assertive?: boolean
  live?: boolean
}

export function Alert({
  tone = 'info',
  title,
  action,
  referenceId,
  assertive,
  live = true,
  className,
  children,
  ...props
}: AlertProps) {
  const meta = STATUS_META[tone]
  const Icon = meta.icon

  return (
    <div
      role={assertive ? 'alert' : 'note'}
      aria-live={live ? (assertive ? 'assertive' : 'polite') : undefined}
      className={cn(
        'flex items-start gap-3 border p-3',
        meta.soft,
        meta.outline,
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-weight-semibold">{title}</p>}
        {children && <div className="text-body-sm">{children}</div>}
        {referenceId && (
          <p className="mt-1 text-body-sm">
            Reference ID:{' '}
            <span className="lw-numeric font-weight-semibold">
              {referenceId}
            </span>
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
