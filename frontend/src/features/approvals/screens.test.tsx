import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { ACTIVE_ROLE_HEADER } from '@/api'
import { renderApp, useLaptopViewport } from '@/test/app'

beforeEach(() => useLaptopViewport())
afterEach(() => vi.unstubAllGlobals())

const REVIEW = '/approvals?scenario=scn-ber-2026-v1'
const tracker = () => within(screen.getByRole('region', { name: 'Approval tracker' }))

describe('SCR-033 Approval review — queue', () => {
  it('lists submissions with step statuses and opens a review; passes axe', async () => {
    const { container, log } = renderApp({ path: '/approvals', role: 'FIN' })
    const link = await screen.findByRole('link', { name: 'Ber months 2026 v1' })
    const row = link.closest('tr')!
    expect(within(row).getByText('Awaiting you')).toBeInTheDocument()
    expect(within(row).getByText('Approved')).toBeInTheDocument()
    expect(log.find((r) => r.path.startsWith('/approvals'))?.headers[ACTIVE_ROLE_HEADER]).toBe('FIN')
    expect(await axe(container)).toHaveNoViolations()
    await userEvent.click(link)
    expect(window.location.search).toBe('?scenario=scn-ber-2026-v1')
    expect(await screen.findByRole('heading', { level: 1, name: 'Review: Ber months 2026 v1' })).toBeInTheDocument()
  })

  it('shows "No access" to roles outside the approval rows', () => {
    renderApp({ path: '/approvals', role: 'PLN' })
    expect(screen.getByRole('heading', { level: 1, name: 'No access' })).toBeInTheDocument()
  })
})

describe('SCR-033 Approval review — decisions', () => {
  it('Finance sees its budget step and must comment to request changes; passes axe', async () => {
    const user = userEvent.setup()
    const { container } = renderApp({ path: REVIEW, role: 'FIN' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Review: Ber months 2026 v1' })).toBeInTheDocument()
    expect(tracker().getByText('L. Tan (HR), Sep 30, 2026, 10:00 AM')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Budget (your step)' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Headcount (your step)' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Approve and publish plan' })).toBeNull()
    expect(await axe(container)).toHaveNoViolations()

    await user.click(screen.getByRole('button', { name: 'Request changes: Budget' }))
    expect(screen.getByText('Add a comment to request changes or reject.')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/^Comment/), 'Trim PT hours')
    await user.click(screen.getByRole('button', { name: 'Request changes: Budget' }))
    expect(await screen.findByText('Returned to the planner as a draft.')).toBeInTheDocument()
    expect(tracker().getByText('“Trim PT hours”')).toBeInTheDocument()
  })

  it('the Executive records budget outside the system, then approves and publishes (P10)', async () => {
    const user = userEvent.setup()
    const { container } = renderApp({ path: REVIEW, role: 'EXE' })
    const publish = await screen.findByRole('button', { name: 'Approve and publish plan' })
    expect(publish).toBeDisabled()
    expect(screen.getByText('Plan buttons stay disabled until headcount and budget are both secured.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject: Plan' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Record headcount/budget secured outside the system' }))
    const dialog = await screen.findByRole('dialog', { name: 'Record as secured outside the system' })
    expect(within(dialog).getByLabelText('Step')).toHaveValue('budget')
    await user.click(within(dialog).getByRole('button', { name: 'Record' }))
    expect(within(dialog).getAllByText('Enter a reference and a note.')).toHaveLength(2)
    await user.type(within(dialog).getByLabelText(/^Reference/), 'email 2 Oct')
    await user.type(within(dialog).getByLabelText(/^Note/), 'Agreed with the CFO')
    expect(await axe(dialog)).toHaveNoViolations()
    await user.click(within(dialog).getByRole('button', { name: 'Record' }))
    expect(await screen.findByText('Recorded as secured outside the system.')).toBeInTheDocument()
    expect(tracker().getByText(/Recorded outside the system by M\. Cruz \(Executive\).*ref “email 2 Oct”/)).toBeInTheDocument()
    expect(tracker().getByText('Ready for the Executive’s decision.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Approve and publish plan' }))
    const confirm = await screen.findByRole('dialog', { name: 'Approve and publish?' })
    expect(within(confirm).getByText(/becomes the published plan for its season/)).toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: 'Approve and publish' }))
    expect(await screen.findByText('Published. Everyone in scope has been notified.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByRole('region', { name: 'Your decision' })).toBeNull()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('HR sees a published tracker read-only and returns to the queue', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/approvals?scenario=scn-xmas-2026-v3', role: 'HR' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Review: Christmas 2026 v3' })).toBeInTheDocument()
    // Published: the tracker is read-only.
    expect(screen.queryByRole('region', { name: 'Your decision' })).toBeNull()
    await user.click(screen.getByRole('link', { name: 'All approvals' }))
    expect(window.location.pathname + window.location.search).toBe('/approvals')
  })
})
