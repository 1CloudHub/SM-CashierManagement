import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { STATUS_META, type StatusTone } from './status'

/**
 * Pill (SG-006). A small rounded tag for status and metadata.
 *
 * The pill radius is the ONE exception to square corners (SG-003: pills and
 * avatars only). Fills: `outline` (default, low emphasis), `soft` (surface
 * emphasis) and `solid` (reserved for the single most urgent status — e.g. a
 * "Published ★" marker or the most severe alert). Accent red is not a pill
 * tone; it is emphasis only.
 */
const pillVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-3 py-0.5 text-label leading-none whitespace-nowrap border',
  {
    variants: {
      fill: {
        outline: 'bg-transparent',
        soft: 'border-transparent',
        solid: 'border-transparent',
      },
    },
    defaultVariants: { fill: 'outline' },
  },
)

export interface PillProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof pillVariants> {
  tone?: StatusTone
}

export function Pill({
  className,
  fill = 'outline',
  tone = 'neutral',
  children,
  ...props
}: PillProps) {
  const meta = STATUS_META[tone]
  const toneClass =
    fill === 'solid' ? meta.solid : fill === 'soft' ? meta.soft : meta.outline

  return (
    <span className={cn(pillVariants({ fill }), toneClass, className)} {...props}>
      {children}
    </span>
  )
}

/**
 * StatusPill — a Pill that always pairs an icon + text + colour, so status is
 * never conveyed by colour alone (accessibility rule, UX-010). Prefer this over
 * a bare Pill for anything that communicates state (Published, Stale, Short…).
 */
export function StatusPill({
  tone = 'neutral',
  fill = 'soft',
  children,
  className,
  ...props
}: PillProps) {
  const Icon = STATUS_META[tone].icon
  return (
    <Pill tone={tone} fill={fill} className={className} {...props}>
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {children}
    </Pill>
  )
}
