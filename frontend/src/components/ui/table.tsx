import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from './skeleton'

/**
 * Table (SG-006, UX-005, accessibility).
 *
 * Token-driven table primitives with:
 *   - a scroll container (TableWrap) with a 2px outline,
 *   - STICKY header row and STICKY first column (via `stickyFirstCol`),
 *   - sortable headers using a real <button> + `aria-sort` (SortHeader),
 *   - numeric columns right-aligned with tabular figures,
 *   - a loading skeleton that matches the column/row shape (TableSkeleton),
 *   - a semantic empty row (TableEmpty) that spans all columns.
 *
 * These stay presentational primitives so screens supply the data; the roles
 * (table/row/columnheader/rowheader) and sort semantics are correct by default
 * so screens don't re-implement them.
 */
export function TableWrap({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'relative max-h-[70vh] overflow-auto border border-outline-subtle bg-surface',
        className,
      )}
      {...props}
    />
  )
}

export function Table({
  className,
  stickyFirstCol,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement> & {
  stickyFirstCol?: boolean
}) {
  return (
    <table
      data-sticky-first={stickyFirstCol || undefined}
      className={cn(
        'w-full border-collapse text-body-sm',
        // Sticky first column: the first cell in header + body rows sticks left.
        stickyFirstCol &&
          '[&_tr>*:first-child]:sticky [&_tr>*:first-child]:left-0 [&_tr>*:first-child]:z-10 [&_tr>*:first-child]:bg-surface',
        className,
      )}
      {...props}
    />
  )
}

export function TableHead({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        // Sticky header row; header cells sit above the sticky first column.
        '[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-surface-2',
        className,
      )}
      {...props}
    />
  )
}

export function TableBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />
}

export function TableRow({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        // Hover steps the surface; a selected row (`data-selected`, set
        // alongside aria-selected or a checked row checkbox, which carry the
        // state for AT) takes the primary-soft selection fill.
        'border-b border-outline-subtle last:border-b-0 motion-interactive hover:bg-surface-2',
        'data-[selected]:bg-primary-soft data-[selected]:hover:bg-primary-soft',
        className,
      )}
      {...props}
    />
  )
}

export function TableHeaderCell({
  className,
  numeric,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-outline px-3 py-2 text-label uppercase text-text-muted',
        numeric ? 'text-right' : 'text-left',
        className,
      )}
      {...props}
    />
  )
}

export function TableCell({
  className,
  numeric,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        'px-3 py-2 align-middle text-text',
        numeric && 'lw-numeric text-right',
        className,
      )}
      {...props}
    />
  )
}

/** Row header cell (first column) — kept as <th scope="row"> for semantics. */
export function TableRowHeader({
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="row"
      className={cn('px-3 py-2 text-left font-weight-medium text-text', className)}
      {...props}
    />
  )
}

export type SortDirection = 'asc' | 'desc' | 'none'

/**
 * SortHeader — a sortable column header. Renders a real button inside a
 * <th aria-sort> so the sort state is exposed to assistive tech and the
 * direction is shown as an icon (not colour). `onSort` toggles/cycles in the
 * parent, which owns the data ordering.
 */
export function SortHeader({
  direction = 'none',
  onSort,
  numeric,
  className,
  children,
}: {
  direction?: SortDirection
  onSort?: () => void
  numeric?: boolean
  className?: string
  children: React.ReactNode
}) {
  const ariaSort =
    direction === 'asc'
      ? 'ascending'
      : direction === 'desc'
        ? 'descending'
        : 'none'
  const Icon =
    direction === 'asc' ? ArrowUp : direction === 'desc' ? ArrowDown : ChevronsUpDown

  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn(
        'sticky top-0 z-20 border-b border-outline bg-surface-2 p-0',
        className,
      )}
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          'motion-interactive flex min-h-tap w-full items-center gap-1 px-3 py-2 text-label uppercase text-text-muted hover:text-text focus-visible:outline-focus-ring',
          numeric ? 'justify-end' : 'justify-start',
        )}
      >
        {children}
        <Icon
          aria-hidden="true"
          className={cn(
            'size-3.5 shrink-0',
            direction === 'none' && 'text-text-muted opacity-60',
          )}
        />
      </button>
    </th>
  )
}

/**
 * TableEmpty — an empty-state row spanning all columns (UX-010). Keeps table
 * semantics valid and explains what to do.
 */
export function TableEmpty({
  colSpan,
  children,
}: {
  colSpan: number
  children: React.ReactNode
}) {
  return (
    <tr data-state="empty">
      <td colSpan={colSpan} className="px-3 py-8 text-center text-text-muted">
        {children}
      </td>
    </tr>
  )
}

/**
 * TableSkeleton — loading rows matching the column count so the table doesn't
 * shift when data lands (UX-010). Labelled for assistive tech; shimmer stops
 * under reduced motion. Header cells keep a visually-hidden name so the loading
 * table has no empty <th> (WCAG).
 */
export function TableSkeleton({
  columns,
  rows = 5,
  label = 'Loading table',
}: {
  columns: number
  rows?: number
  label?: string
}) {
  return (
    <TableWrap role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Table>
        <TableHead>
          <TableRow>
            {Array.from({ length: columns }).map((_, i) => (
              <TableHeaderCell key={i}>
                <span className="sr-only">Column {i + 1}</span>
                <Skeleton className="h-3 w-16" />
              </TableHeaderCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {Array.from({ length: rows }).map((_, r) => (
            <TableRow key={r}>
              {Array.from({ length: columns }).map((_, c) => (
                <TableCell key={c}>
                  <Skeleton className="h-4 w-full" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableWrap>
  )
}
