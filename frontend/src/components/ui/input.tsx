import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

/**
 * Input (SG-006). Square corners, 2px outline, token type + spacing.
 *
 * `invalid` wires the error styling and `aria-invalid`; pair it with a Field
 * so the message is associated via `aria-describedby`. Every input needs a
 * `<label>` — use Field or a plain associated <label> (UX-004).
 */
const baseControl =
  'w-full min-h-tap border border-outline bg-surface text-text text-body px-3 rounded-none motion-interactive placeholder:text-text-muted focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:border-outline-subtle disabled:bg-surface-2 disabled:text-text-muted aria-invalid:border-danger'

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, type = 'text', ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(baseControl, className)}
      {...props}
    />
  )
})

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, invalid, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(baseControl, 'min-h-[5rem] py-2', className)}
        {...props}
      />
    )
  },
)

export { baseControl }
