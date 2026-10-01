import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { render } from '@testing-library/react'
import { RBAC_RESOURCES, type FileDownload } from '@lanewise/shared'
import { ACTIVE_ROLE_HEADER, createApiClient, createMockAdapter } from '@/api'
import { I18nProvider } from '@/i18n'
import { renderApp, useLaptopViewport } from '@/test/app'
import { createAdminClient } from './api'
import { AuditScreen } from './audit-screen'

beforeEach(() => useLaptopViewport())
afterEach(() => vi.unstubAllGlobals())

const row = (name: string) => screen.getByRole('rowheader', { name }).closest('tr')!

describe('SCR-070 Users', () => {
  it('lists users with roles, scope and status, the demo banner, and passes axe', async () => {
    const { container, log } = renderApp({ path: '/admin/users', role: 'ADM' })
    expect(await screen.findByRole('rowheader', { name: 'Ana Reyes' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Users' })).toBeInTheDocument()
    expect(screen.getByText(/Demo mode is on/)).toBeInTheDocument()
    const ana = within(row('Ana Reyes'))
    expect(ana.getByText('Planner')).toBeInTheDocument()
    expect(ana.getByText('Luzon')).toBeInTheDocument()
    expect(ana.getByText('Active')).toBeInTheDocument()
    expect(within(row('Juan dela Cruz')).getByRole('button', { name: 'Resend invitation to Juan dela Cruz' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '+ Invite user' })).toHaveAttribute('href', '/admin/users/invite')
    expect(log.find((r) => r.path.startsWith('/admin/users'))?.headers[ACTIVE_ROLE_HEADER]).toBe('ADM')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('filters by status and role', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/admin/users', role: 'ADM' })
    await screen.findByRole('rowheader', { name: 'Ana Reyes' })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'disabled')
    await waitFor(() => expect(screen.queryByRole('rowheader', { name: 'Ana Reyes' })).toBeNull())
    expect(screen.getByRole('rowheader', { name: 'K. Lim' })).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Role' }), 'FIN')
    expect(await screen.findByText('No users match')).toBeInTheDocument()
  })

  it('asks for confirmation before deactivating, then shows the new status', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/admin/users', role: 'ADM' })
    await screen.findByRole('rowheader', { name: 'Ana Reyes' })
    await user.click(screen.getByRole('button', { name: 'Deactivate Ana Reyes' }))
    const dialog = screen.getByRole('dialog', { name: 'Deactivate Ana Reyes?' })
    expect(within(dialog).getByText(/can no longer access the planner/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }))
    expect(await screen.findByText('Ana Reyes is deactivated and signed out.')).toBeInTheDocument()
    expect(within(row('Ana Reyes')).getByText('Deactivated')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Deactivate Ana Reyes' })).toBeNull()
  })

  it('re-sends a pending invitation', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/admin/users', role: 'ADM' })
    await user.click(await screen.findByRole('button', { name: 'Resend invitation to Juan dela Cruz' }))
    expect(await screen.findByText('Invitation sent again to juan@smretail.com.')).toBeInTheDocument()
  })
})

describe('SCR-071 Invite / edit user', () => {
  it('validates the work email against the allowlist and needs a role; passes axe', async () => {
    const user = userEvent.setup()
    const { container, log } = renderApp({ path: '/admin/users/invite', role: 'ADM' })
    const email = await screen.findByRole('textbox', { name: /Work email/ })
    expect(screen.getByText('Must end in @smretail.com or @1cloudhub.com')).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
    await user.type(email, 'maria@gmail.com')
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))
    expect(screen.getByText("This work email domain isn't allowed.")).toBeInTheDocument()
    expect(screen.getByText('Choose at least one role.')).toBeInTheDocument()
    expect(email).toHaveFocus()
    expect(log.some((r) => r.method === 'POST')).toBe(false)
  })

  it('shows the region or store selector for the chosen scope and sends the invitation', async () => {
    const user = userEvent.setup()
    const { log } = renderApp({ path: '/admin/users/invite', role: 'ADM' })
    await user.type(await screen.findByRole('textbox', { name: /Work email/ }), 'maria.santos@smretail.com')
    await user.click(screen.getByRole('checkbox', { name: 'Planner' }))
    await user.click(screen.getByRole('checkbox', { name: 'HR' }))
    expect(screen.queryByRole('group', { name: 'Regions' })).toBeNull()
    await user.click(screen.getByRole('radio', { name: 'Region' }))
    const regions = screen.getByRole('group', { name: 'Regions' })
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))
    expect(screen.getByText('Choose at least one region.')).toBeInTheDocument()
    await user.click(within(regions).getByRole('checkbox', { name: 'Luzon' }))
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))
    expect(await screen.findByText('Invitation sent to maria.santos@smretail.com.', {}, { timeout: 4000 })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/admin/users')
    const post = log.find((r) => r.method === 'POST' && r.path === '/admin/users')
    expect(post?.body).toEqual({ email: 'maria.santos@smretail.com', roles: ['PLN', 'HR'], scope: { type: 'region', regionIds: ['region-luzon'] } })
    expect(within(row('maria.santos')).getByText('Invited')).toBeInTheDocument()
  })

  it('disables the scope for a Staff-only invitation', async () => {
    const user = userEvent.setup()
    renderApp({ path: '/admin/users/invite', role: 'ADM' })
    await user.click(await screen.findByRole('checkbox', { name: 'Staff' }))
    expect(screen.getByRole('group', { name: 'Data scope' })).toBeDisabled()
    expect(screen.getByText(/Staff is always scoped/)).toBeInTheDocument()
  })

  it('edits an existing user’s roles', async () => {
    const user = userEvent.setup()
    const { log } = renderApp({ path: '/admin/users/u-fin-rsantos', role: 'ADM' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit user: R. Santos' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Finance' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Global' })).toBeChecked()
    await user.click(screen.getByRole('checkbox', { name: 'Executive' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Changes to R. Santos saved.', {}, { timeout: 4000 })).toBeInTheDocument()
    expect(log.find((r) => r.method === 'PATCH')?.body).toMatchObject({ roles: ['EXE', 'FIN'], scope: { type: 'global' } })
  })

  it('answers an unknown user with No access', async () => {
    renderApp({ path: '/admin/users/u-nobody', role: 'ADM' })
    expect(await screen.findByRole('heading', { name: 'No access' })).toBeInTheDocument()
  })
})

describe('SCR-072 Roles and permissions', () => {
  it('renders every matrix row with letters and a text legend; passes axe', async () => {
    const { container } = renderApp({ path: '/admin/roles', role: 'ADM' })
    expect(screen.getByRole('heading', { level: 1, name: 'Roles and permissions' })).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Permission matrix: capabilities by role' })
    expect(within(table).getAllByRole('rowheader')).toHaveLength(RBAC_RESOURCES.length)
    const users = within(table).getByRole('rowheader', { name: 'Users and roles (SCR-070–072)' }).closest('tr')!
    expect(within(users).getByText('M')).toBeInTheDocument()
    const audit = within(table).getByRole('rowheader', { name: 'Audit log (SCR-073)' }).closest('tr')!
    expect(within(audit).getByText('V X')).toBeInTheDocument()
    expect(within(audit).getByText('data/rules events')).toBeInTheDocument()
    const legend = screen.getByRole('region', { name: 'Legend' })
    expect(within(legend).getByText('Manage')).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('SCR-073 Audit log', () => {
  it('lists events newest first with filters, exports CSV (recorded), and passes axe', async () => {
    const user = userEvent.setup()
    const { container } = renderApp({ path: '/admin/audit', role: 'ADM' })
    const first = await screen.findAllByRole('rowheader')
    expect(first.length).toBeGreaterThan(3)
    expect(screen.getByText('scenario.submitted')).toBeInTheDocument()
    expect(screen.getByText('ncrBaseRate: 85 → 87')).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Event type' }), 'rules')
    await waitFor(() => expect(screen.queryByText('scenario.submitted')).toBeNull())
    expect(screen.getByText('rule_version.published')).toBeInTheDocument()

    await user.type(screen.getByLabelText('From'), '2026-10-05')
    await user.type(screen.getByLabelText('To'), '2026-10-01')
    expect(screen.getByText('The To date is before the From date.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
  })

  it('a Rules Steward sees data and rules events only and cannot export', async () => {
    renderApp({ path: '/admin/audit', role: 'RST' })
    expect(await screen.findByText('rule_version.published')).toBeInTheDocument()
    expect(screen.getByText('Rules Stewards see data and rules events only.')).toBeInTheDocument()
    expect(screen.queryByText('scenario.submitted')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull()
    expect(within(screen.getByRole('combobox', { name: 'Event type' })).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'All',
      'Data',
      'Rules',
    ])
  })

  it('downloads the export and the export itself appears in the log', async () => {
    const user = userEvent.setup()
    const save = vi.fn<(file: FileDownload) => void>()
    const client = createAdminClient(createApiClient({ adapter: createMockAdapter(), getActiveRole: () => 'ADM' }))
    render(
      <I18nProvider initialLocale="en">
        <AuditScreen client={client} role="ADM" save={save} />
      </I18nProvider>,
    )
    await user.click(await screen.findByRole('button', { name: 'Export CSV' }))
    expect(await screen.findByText(/Audit log exported/)).toBeInTheDocument()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'audit-log.csv', contentType: 'text/csv' }))
    expect(save.mock.calls[0]?.[0].content).toContain('scenario.submitted')
    const log = await client.auditLog({ category: 'export' })
    expect(log.events.map((e) => e.event)).toEqual(['export.generated'])
  })
})
