import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Stack } from '@/components/layout/stack'

/**
 * Small presentational helpers shared by the gallery sections (task 1.10).
 *
 * These are reference-only scaffolding for the style guide itself — they keep
 * every section visually consistent (a labelled sub-block, a token swatch, a
 * specimen with its name) without re-implementing markup per section. They are
 * token-driven like everything else (2px outlines, square corners, spacing
 * scale, token colour) and add no product copy.
 */

/** A labelled sub-block within a gallery section. Renders an h3 + body. */
export function Subsection({
  title,
  hint,
  children,
  className,
}: {
  title: string
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Stack gap={3} as="div" className={className}>
      <div>
        <h3 className="text-h3 text-text">{title}</h3>
        {hint && <p className="mt-1 text-body-sm text-text-muted">{hint}</p>}
      </div>
      {children}
    </Stack>
  )
}

/**
 * A single colour token swatch: a fill block with the semantic token name and
 * (optionally) an on-colour sample so the accessible pairing is visible.
 */
export function Swatch({
  token,
  onToken,
  sample = 'Aa',
}: {
  /** The semantic token, e.g. "bg-primary" (a Tailwind utility bound to it). */
  token: string
  /** The on-colour utility for legible text on the fill, e.g. "text-on-primary". */
  onToken?: string
  sample?: string
}) {
  return (
    <div className="flex flex-col border border-outline">
      <div
        className={cn(
          'flex h-14 items-center justify-center',
          token,
          onToken,
        )}
      >
        {onToken && <span className="text-body-sm">{sample}</span>}
      </div>
      <code className="border-t border-outline bg-surface px-2 py-1 text-caption text-text-muted">
        {token}
      </code>
    </div>
  )
}

/**
 * A specimen: a component example paired with a caption naming what it shows,
 * so the reference reads as documentation rather than a wall of controls.
 */
export function Specimen({
  name,
  children,
  className,
}: {
  name: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('border border-outline-subtle bg-surface', className)}>
      <div className="flex flex-wrap items-center gap-3 p-4">{children}</div>
      <p className="border-t border-outline-subtle bg-surface-2 px-4 py-2 text-caption text-text-muted">
        {name}
      </p>
    </div>
  )
}

/**
 * A spec row for a token reference: a name (code) paired with a value/note.
 * Rendered as a plain flex row (not a <dl>) so it composes freely inside any
 * container without definition-list structural constraints.
 */
export function SpecRow({
  name,
  value,
  children,
}: {
  name: string
  value?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-outline-subtle py-2 last:border-b-0">
      <div className="flex items-center gap-3">
        {children}
        <code className="text-body-sm text-text">{name}</code>
      </div>
      {value != null && (
        <span className="text-body-sm text-text-muted">{value}</span>
      )}
    </div>
  )
}
