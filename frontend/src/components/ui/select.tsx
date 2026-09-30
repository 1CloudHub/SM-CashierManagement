import { ChevronDown } from 'lucide-react'
import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

/**
 * Select (SG-006) — a styled native <select> for accessibility and reliable
 * mobile behaviour. Square corners, 2px outline, token type. Needs a label
 * (use Field or an associated <label>). The chevron is decorative.
 */
export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ className, invalid, children, ...props }, ref) {
    return (
      <div className="relative inline-flex w-full">
        <select
          ref={ref}
          aria-invalid={invalid || undefined}
          className={cn(
            'w-full min-h-tap appearance-none border-2 border-outline bg-surface text-text text-body pl-3 pr-9 rounded-none motion-interactive focus-visible:outline-focus-ring disabled:opacity-50 aria-invalid:border-danger',
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-muted"
        />
      </div>
    )
  },
)
