import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Stack } from './stack'
import { type Gap } from './scale'

/**
 * Section (design.md "Layout primitives" — a labelled card region).
 *
 * A titled content region rendered as a <section> landmark wired to its
 * heading via aria-labelledby (UX-005 information hierarchy, UX-004). Screens
 * use it to break a page into labelled blocks — "KPI cards", "Shift builder",
 * "Recent scenarios" — without re-wiring the heading/landmark relationship
 * each time.
 *
 * `title` is the heading; `titleAs` chooses the heading level so the document
 * outline stays correct (default h2). `actions` sits opposite the title for a
 * per-section toolbar. `bare` drops the card chrome (2px outline + surface +
 * padding) for sections that only need the labelled grouping. `id` is
 * forwarded to the <section> so it can be an in-page anchor target (e.g. a
 * section index / gallery nav). Inner spacing is the spacing scale (SG-005)
 * via a Stack.
 */
export interface SectionProps {
  /** Section heading. Omit only when providing an external aria-label. */
  title?: ReactNode
  titleAs?: 'h2' | 'h3' | 'h4'
  /** Accessible name when there is no visible title. */
  'aria-label'?: string
  /** Anchor id forwarded to the <section> (for in-page section navigation). */
  id?: string
  /** Trailing controls shown opposite the title. */
  actions?: ReactNode
  /** Supporting line under the title. */
  description?: ReactNode
  /** Drop the card chrome (outline/surface/padding). */
  bare?: boolean
  /** Spacing-scale gap between the header and the body. Default 4 (16px). */
  gap?: Gap
  className?: string
  children?: ReactNode
}

export function Section({
  title,
  titleAs: Heading = 'h2',
  actions,
  description,
  bare = false,
  gap = 4,
  id,
  className,
  children,
  ...aria
}: SectionProps) {
  const headingId = useId()
  const labelled = title ? headingId : undefined

  return (
    <section
      id={id}
      aria-labelledby={labelled}
      aria-label={aria['aria-label']}
      className={cn(!bare && 'border border-outline bg-surface p-4', className)}
    >
      <Stack gap={gap}>
        {(title || actions || description) && (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {title && (
                <Heading id={headingId} className="text-h3 text-text">
                  {title}
                </Heading>
              )}
              {description && (
                <p className="mt-1 text-body-sm text-text-muted">{description}</p>
              )}
            </div>
            {actions && <div className="shrink-0">{actions}</div>}
          </div>
        )}
        {children}
      </Stack>
    </section>
  )
}
