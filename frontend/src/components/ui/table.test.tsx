import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import {
  SortHeader,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableRowHeader,
  TableSkeleton,
  TableWrap,
  type SortDirection,
} from './table'

function renderTable(direction: SortDirection = 'none', onSort = vi.fn()) {
  return render(
    <TableWrap>
      <Table stickyFirstCol>
        <caption>Recent scenarios</caption>
        <TableHead>
          <TableRow>
            <SortHeader direction={direction} onSort={onSort}>
              Scenario
            </SortHeader>
            <TableHeaderCell numeric>Cost</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableRowHeader>Christmas 2026 v3</TableRowHeader>
            <TableCell numeric>13.6</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </TableWrap>,
  )
}

describe('Table', () => {
  it('exposes table semantics with row and column headers', () => {
    renderTable()
    expect(screen.getByRole('table', { name: 'Recent scenarios' })).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: /scenario/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('rowheader', { name: 'Christmas 2026 v3' }),
    ).toBeInTheDocument()
  })

  it('marks the first column sticky when requested', () => {
    renderTable()
    expect(screen.getByRole('table')).toHaveAttribute('data-sticky-first', 'true')
  })

  it('reflects sort direction via aria-sort and fires onSort on click', async () => {
    const onSort = vi.fn()
    renderTable('asc', onSort)
    const header = screen.getByRole('columnheader', { name: /scenario/i })
    expect(header).toHaveAttribute('aria-sort', 'ascending')
    await userEvent.click(screen.getByRole('button', { name: /scenario/i }))
    expect(onSort).toHaveBeenCalledOnce()
  })

  it('shows aria-sort="none" when unsorted', () => {
    renderTable('none')
    expect(
      screen.getByRole('columnheader', { name: /scenario/i }),
    ).toHaveAttribute('aria-sort', 'none')
  })

  it('renders an empty state spanning the columns', () => {
    render(
      <TableWrap>
        <Table>
          <TableBody>
            <TableEmpty colSpan={2}>No scenarios match.</TableEmpty>
          </TableBody>
        </Table>
      </TableWrap>,
    )
    expect(screen.getByText('No scenarios match.')).toBeInTheDocument()
  })

  it('renders a labelled loading skeleton', () => {
    render(<TableSkeleton columns={3} rows={2} label="Loading table" />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading table')
  })

  it('has no axe violations', async () => {
    const { container } = renderTable('asc')
    expect(await axe(container)).toHaveNoViolations()
  })
})
