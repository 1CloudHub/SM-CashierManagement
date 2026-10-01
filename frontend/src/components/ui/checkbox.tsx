import { forwardRef, useCallback, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

/**
 * Checkbox & Radio (SG-006, UX-004, WCAG 2.5.8).
 *
 * Native inputs (so keyboard, forms and assistive tech behave by default)
 * tinted with the primary role via `accent-color`, each wrapped in its own
 * <label> that is the ≥44px touch target — the whole row toggles the control,
 * not just the 16px box. The label text is the accessible name; pass
 * `hideLabel` where a visible label would repeat a column header (e.g. a row
 * selection box in a table) and it stays available to AT via `sr-only`.
 *
 * `description` adds a muted second line inside the label (so it is part of
 * the accessible name). Disabled controls use token colours (muted text,
 * not-allowed cursor), never opacity.
 */
interface ChoiceProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** The visible (or, with hideLabel, visually hidden) accessible name. */
  label: React.ReactNode
  /** Visually hide the label text (still the accessible name). */
  hideLabel?: boolean
  /** Secondary line under the label. */
  description?: React.ReactNode
  /** Class for the wrapping <label> (the touch target). */
  className?: string
  /** Class for the input itself. */
  inputClassName?: string
}

const labelBase =
  'inline-flex min-h-tap min-w-tap cursor-pointer items-center gap-2 text-body text-text has-disabled:cursor-not-allowed has-disabled:text-text-muted'
const inputBase =
  'size-4 shrink-0 cursor-pointer rounded-none accent-primary disabled:cursor-not-allowed'

function ChoiceText({
  label,
  hideLabel,
  description,
}: Pick<ChoiceProps, 'label' | 'hideLabel' | 'description'>) {
  if (hideLabel) return <span className="sr-only">{label}</span>
  return (
    <span className="flex min-w-0 flex-col">
      <span>{label}</span>
      {description && (
        <span className="text-body-sm text-text-muted">{description}</span>
      )}
    </span>
  )
}

export interface CheckboxProps extends ChoiceProps {
  /** Shows the mixed state (e.g. "select all" with some rows selected). */
  indeterminate?: boolean
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox(
    {
      label,
      hideLabel,
      description,
      className,
      inputClassName,
      indeterminate = false,
      ...props
    },
    ref,
  ) {
    const inner = useRef<HTMLInputElement | null>(null)
    // Keep a local handle (for `indeterminate`) and forward the node.
    const setRef = useCallback(
      (node: HTMLInputElement | null) => {
        inner.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) ref.current = node
      },
      [ref],
    )
    // `indeterminate` is a DOM property only (no attribute).
    useEffect(() => {
      if (inner.current) inner.current.indeterminate = indeterminate
    }, [indeterminate])

    return (
      <label className={cn(labelBase, hideLabel && 'justify-center', className)}>
        <input
          ref={setRef}
          type="checkbox"
          className={cn(inputBase, inputClassName)}
          {...props}
        />
        <ChoiceText label={label} hideLabel={hideLabel} description={description} />
      </label>
    )
  },
)

export type RadioProps = ChoiceProps

export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { label, hideLabel, description, className, inputClassName, ...props },
  ref,
) {
  return (
    <label className={cn(labelBase, hideLabel && 'justify-center', className)}>
      <input
        ref={ref}
        type="radio"
        className={cn(inputBase, inputClassName)}
        {...props}
      />
      <ChoiceText label={label} hideLabel={hideLabel} description={description} />
    </label>
  )
})
