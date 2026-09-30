import { useId } from 'react'
import { cn } from '@/lib/utils'

/**
 * Label (SG-006, UX-004). Token type; associates via htmlFor. Shows a required
 * marker with text, not colour alone.
 */
export function Label({
  className,
  required,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label className={cn('text-label text-text', className)} {...props}>
      {children}
      {required && (
        <span className="text-danger">
          {' '}
          *<span className="sr-only"> (required)</span>
        </span>
      )}
    </label>
  )
}

export interface FieldProps {
  label: React.ReactNode
  /** Optional hint shown under the label (never tooltip-only for essentials). */
  hint?: React.ReactNode
  /** Field-level error message; sets aria-invalid + aria-describedby wiring. */
  error?: React.ReactNode
  required?: boolean
  className?: string
  /**
   * Render prop receiving the ids/aria to spread onto the control, so the
   * control stays the accessible source of truth (UX-004).
   */
  children: (aria: {
    id: string
    'aria-describedby'?: string
    'aria-invalid'?: true
    'aria-required'?: true
  }) => React.ReactNode
}

/**
 * Field — a label + control + hint + error group with the ARIA wiring done
 * once (UX-010 error state, UX-004 labelling). The control is associated to its
 * label, its hint and its error, and marked invalid when an error is present.
 */
export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: FieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') ||
    undefined

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      {hint && (
        <p id={hintId} className="text-body-sm text-text-muted">
          {hint}
        </p>
      )}
      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        'aria-required': required || undefined,
      })}
      {error && (
        <p
          id={errorId}
          className="flex items-center gap-1 text-body-sm text-on-danger-soft"
        >
          {error}
        </p>
      )}
    </div>
  )
}
