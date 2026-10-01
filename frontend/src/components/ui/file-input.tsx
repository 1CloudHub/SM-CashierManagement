import { forwardRef, useId } from 'react'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { formatFileSize } from './file-size'
import { baseControl } from './input'

/**
 * FileInput (SG-006, UX-004). A single-file picker that looks and sizes like
 * the other inputs (same `baseControl` recipe: tap-target height, 2px outline,
 * token type) and shows the chosen file's name and size, formatted for the
 * active locale.
 *
 * The native `<input type="file">` stays the accessible source of truth: it is
 * stretched invisibly over the control, so it keeps its label (pass the Field
 * aria/id props), keyboard focus and the OS picker; the visible focus ring is
 * drawn on the wrapper. The file summary is wired into `aria-describedby` and
 * announced politely when it changes. The component is controlled: the shown
 * file comes from `file`, so it survives the step flow re-mounting the input.
 */
export interface FileInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'type' | 'value' | 'defaultValue' | 'onChange' | 'multiple' | 'children'
  > {
  /** The chosen file (controlled). */
  file: File | null
  onFileChange: (file: File | null) => void
  /** Visible text of the picker affordance, e.g. "Choose file". */
  chooseLabel: string
  /** Shown when no file is chosen, e.g. "No file chosen". */
  emptyLabel: string
  invalid?: boolean
}

export const FileInput = forwardRef<HTMLInputElement, FileInputProps>(
  function FileInput(
    {
      file,
      onFileChange,
      chooseLabel,
      emptyLabel,
      invalid,
      className,
      disabled,
      'aria-describedby': describedBy,
      ...props
    },
    ref,
  ) {
    const { formatNumber } = useI18n()
    const summaryId = `${useId()}-file`

    return (
      <div
        className={cn(
          baseControl,
          'relative flex items-stretch gap-3 overflow-hidden pl-0',
          'has-[input:focus-visible]:outline-solid has-[input:focus-visible]:outline-(length:--lw-outline-w) has-[input:focus-visible]:outline-focus-ring has-[input:focus-visible]:outline-offset-2',
          invalid && 'border-danger',
          disabled && 'opacity-50',
          className,
        )}
      >
        <input
          ref={ref}
          type="file"
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={[describedBy, summaryId].filter(Boolean).join(' ')}
          className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
          {...props}
        />
        <span
          aria-hidden="true"
          className="inline-flex shrink-0 items-center bg-surface-2 px-3 font-weight-semibold text-text"
        >
          {chooseLabel}
        </span>
        <span
          id={summaryId}
          aria-live="polite"
          className="flex min-w-0 flex-1 items-center gap-2"
        >
          {file ? (
            <>
              <span className="truncate text-text">{file.name}</span>
              {/* Word break for the accessible description (name, then size). */}{' '}
              <span className="lw-numeric shrink-0 text-body-sm text-text-muted">
                {formatFileSize(file.size, formatNumber)}
              </span>
            </>
          ) : (
            <span className="truncate text-text-muted">{emptyLabel}</span>
          )}
        </span>
      </div>
    )
  },
)
