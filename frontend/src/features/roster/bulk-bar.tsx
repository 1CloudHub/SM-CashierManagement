import { X } from 'lucide-react'
import { BULK_ACTIONS, type BulkAction } from './types'
import { useRosterFormat } from './use-roster-format'

/**
 * The bulk-action bar (wireframe BULK): appears while shifts are selected on
 * the Day timeline and offers Edit / Reassign / Time off / Copy to. It is a
 * labelled group of ordinary buttons (Tab moves between them).
 */
export function BulkBar({
  count,
  onAction,
  onClear,
}: {
  count: number
  onAction: (action: BulkAction) => void
  onClear: () => void
}) {
  const f = useRosterFormat()
  if (count === 0) return null
  const btn =
    'min-h-tap border border-bg bg-transparent px-3 text-body-sm font-weight-bold text-bg motion-interactive hover:bg-bg hover:text-text focus-visible:outline-focus-ring'
  return (
    <div
      role="group"
      aria-label={f.t('roster.bulk.label')}
      className="sticky bottom-3 z-10 mx-auto flex w-max max-w-full flex-wrap items-center gap-3 bg-text px-4 py-2 text-bg"
    >
      <span aria-live="polite" className="text-body-sm font-weight-semibold">
        {count === 1
          ? f.t('roster.bulk.countOne')
          : f.t('roster.bulk.countOther', { count: f.num(count) })}
      </span>
      <button
        type="button"
        className={`${btn} min-w-tap`}
        aria-label={f.t('roster.bulk.clear')}
        onClick={onClear}
      >
        <X aria-hidden="true" className="mx-auto size-4" />
      </button>
      {BULK_ACTIONS.map((a) => (
        <button key={a} type="button" className={btn} onClick={() => onAction(a)}>
          {f.t(`roster.bulk.${a}`)}
        </button>
      ))}
    </div>
  )
}
