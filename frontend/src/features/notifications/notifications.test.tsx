import {
  LANGUAGES,
  NOTIFICATION_EVENT_NAMES,
  ROLE_CODES,
  type NotificationItem,
  type NotificationListResponse,
  type RoleCode,
} from '@lanewise/shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { createApiClient, createMockAdapter, type ApiRequest } from '@/api'
import { BUNDLES } from '@/i18n'
import { translate } from '@/i18n/translate'
import { renderApp, useLaptopViewport } from '@/test/app'
import { createNotificationsClient } from './api'
import { notificationTitle } from './text'

beforeEach(() => useLaptopViewport())
afterEach(() => vi.unstubAllGlobals())

function mockClient(role: RoleCode) {
  return createNotificationsClient(createApiClient({ adapter: createMockAdapter(), getActiveRole: () => role }))
}

describe('mock notifications mirror the API (P11)', () => {
  it('each role only ever sees and marks read its own inbox', async () => {
    const adapter = createMockAdapter()
    const lists = new Map<RoleCode, NotificationListResponse>()
    for (const role of ROLE_CODES) {
      const client = createNotificationsClient(createApiClient({ adapter, getActiveRole: () => role }))
      lists.set(role, await client.list({ limit: 100 }))
    }
    for (const role of ROLE_CODES) {
      const mine = lists.get(role)!.items.map((i) => i.id)
      expect(mine.length).toBeGreaterThan(0)
      for (const id of mine) expect(id.startsWith(`ntf-${role.toLowerCase()}-`)).toBe(true)
      const other = ROLE_CODES.find((r) => r !== role)!
      const theirs = lists.get(other)!.items[0]!.id
      const client = createNotificationsClient(createApiClient({ adapter, getActiveRole: () => role }))
      await expect(client.markRead(theirs)).rejects.toMatchObject({ status: 404 })
    }
    // Staff only get their own shift and offer updates — no planning items.
    expect(lists.get('STF')!.items.map((i) => i.category)).toEqual(expect.arrayContaining(['roster', 'offers']))
    expect(lists.get('STF')!.items.every((i) => i.category === 'roster' || i.category === 'offers')).toBe(true)
  })

  it('approvals cannot be turned off; other categories hide from the list when in-app is off', async () => {
    const client = mockClient('PLN')
    await expect(client.updatePreferences({ preferences: [{ category: 'approvals', email: false }] })).rejects.toMatchObject({ status: 422 })
    const before = await client.list({ limit: 100 })
    expect(before.items.some((i) => i.category === 'data')).toBe(true)
    await client.updatePreferences({ preferences: [{ category: 'data', inApp: false }] })
    const after = await client.list({ limit: 100 })
    expect(after.items.some((i) => i.category === 'data')).toBe(false)
  })
})

describe('notification text (requirement 20.5)', () => {
  it('renders every catalogue event in both languages without unresolved placeholders', () => {
    for (const locale of LANGUAGES) {
      const t = (id: string, values?: Record<string, string | number>) => translate(BUNDLES, locale, id, values)
      for (const event of NOTIFICATION_EVENT_NAMES) {
        const item: NotificationItem = {
          id: 'n1',
          event,
          category: null,
          severity: 'info',
          objectType: 'scenario',
          objectId: 's1',
          objectName: 'Christmas 2026 v4',
          params: { step: 'budget', decision: 'approved', outcome: 'accepted', storeName: 'SM QC', fromStore: 'SM QC', startsAt: '2026-12-19T04:00:00Z' },
          link: '/',
          createdAt: '2026-10-01T00:00:00Z',
          readAt: null,
          synthetic: false,
        }
        const title = notificationTitle(item, { t, formatDateTime: (v) => new Date(v).toISOString() })
        expect(title, `${locale} ${event}`).not.toMatch(/\{|notifications\./)
      }
    }
  })
})

describe('SCR-040 Notifications', () => {
  it('lists the role’s notifications with filters, deep links and no axe violations', async () => {
    const { container } = renderApp({ path: '/notifications', role: 'PLN' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Notifications' })).toBeInTheDocument()
    const table = await screen.findByRole('table', { name: 'Notifications' })
    expect(within(table).getByText('Run complete — Christmas 2026 v4')).toBeInTheDocument()
    expect(within(table).getAllByRole('link', { name: 'Open' })[0]).toHaveAttribute('href', expect.stringMatching(/^\//))
    const tabs = screen.getByRole('tablist', { name: 'Filter notifications' })
    expect(within(tabs).getByRole('tab', { name: 'Unread (4)' })).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()

    await userEvent.click(within(tabs).getByRole('tab', { name: 'Data' }))
    await waitFor(() => expect(window.location.search).toBe('?filter=data'))
    const filtered = await screen.findByRole('table', { name: 'Notifications' })
    await waitFor(() => expect(within(filtered).getAllByRole('row')).toHaveLength(2))
    expect(within(filtered).getByText('Data load succeeded — pos_hourly_2026-09.csv')).toBeInTheDocument()
  })

  it('Mark all read clears the unread count on the page and the bell', async () => {
    renderApp({ path: '/notifications', role: 'HR' })
    const bell = await screen.findByRole('button', { name: 'Notifications, 2 unread' })
    await screen.findByRole('table', { name: 'Notifications' })
    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Unread (0)' })).toBeInTheDocument())
    await waitFor(() => expect(bell).toHaveAccessibleName('Notifications'))
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeDisabled()
  })

  it('Staff see only their own shift and offer notifications', async () => {
    renderApp({ path: '/notifications', role: 'STF' })
    const table = await screen.findByRole('table', { name: 'Notifications' })
    expect(within(table).getByText(/^Your shift changed — /)).toBeInTheDocument()
    expect(within(table).getByText(/^Open shift offered at SM Supermarket – Quezon City/)).toBeInTheDocument()
    expect(within(table).queryByText(/Christmas 2026/)).toBeNull()
  })

  it('shows the empty state when nothing matches', async () => {
    renderApp({ path: '/notifications?filter=rules', role: 'EXE' })
    expect(await screen.findByText('You’re all caught up.')).toBeInTheDocument()
  })

  it('edits preferences: mandatory categories are locked, saving sends only the changes', async () => {
    const log: ApiRequest[] = []
    renderApp({ path: '/notifications', role: 'PLN', adapter: createMockAdapter({ log }) })
    await screen.findByRole('table', { name: 'Notifications' })
    await userEvent.click(screen.getByRole('button', { name: 'Preferences' }))
    const dialog = await screen.findByRole('dialog', { name: 'Notification preferences' })
    const approvals = within(dialog).getByRole('rowheader', { name: 'Approvals (required)' }).closest('tr')!
    expect(within(approvals).getAllByText('Always on')).toHaveLength(2)
    expect(within(approvals).queryByRole('checkbox')).toBeNull()
    const email = within(dialog).getByRole('checkbox', { name: 'Data ingestion: Email' })
    expect(email).toBeChecked()
    await userEvent.click(email)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const put = log.find((r) => r.method === 'PUT' && r.path === '/notification-preferences')
    expect(put?.body).toEqual({ preferences: [{ category: 'data', email: false }] })

    await userEvent.click(screen.getByRole('button', { name: 'Preferences' }))
    const reopened = await screen.findByRole('dialog', { name: 'Notification preferences' })
    expect(await within(reopened).findByRole('checkbox', { name: 'Data ingestion: Email' })).not.toBeChecked()
  })
})

describe('top-bar bell', () => {
  it('shows the unread count in its name and the latest items with deep links', async () => {
    const { container } = renderApp({ path: '/', role: 'PLN' })
    const bell = await screen.findByRole('button', { name: 'Notifications, 4 unread' })
    expect(bell).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(bell)
    expect(bell).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('region', { name: 'Latest notifications' })
    const links = within(menu).getAllByRole('link')
    expect(links.length).toBeLessThanOrEqual(6)
    expect(within(menu).getByRole('link', { name: 'See all notifications' })).toHaveAttribute('href', '/notifications')
    expect(within(menu).getByRole('link', { name: /Run complete — Christmas 2026 v4/ })).toHaveAttribute(
      'href',
      '/scenarios/scn-xmas-2026-v4/settings',
    )
    expect(await axe(container)).toHaveNoViolations()

    await userEvent.keyboard('{Escape}')
    expect(bell).toHaveAttribute('aria-expanded', 'false')
    expect(bell).toHaveFocus()
  })

  it('opening an unread item marks it read and goes to the object', async () => {
    renderApp({ path: '/', role: 'EXE' })
    const bell = await screen.findByRole('button', { name: 'Notifications, 2 unread' })
    await userEvent.click(bell)
    const menu = screen.getByRole('region', { name: 'Latest notifications' })
    await userEvent.click(within(menu).getByRole('link', { name: /Plan ready for your approval/ }))
    await waitFor(() => expect(window.location.pathname).toBe('/approvals'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument())
  })

  it('is translated (Filipino)', async () => {
    renderApp({ path: '/', role: 'HR' })
    // The shell's language switcher changes every label, including the bell's.
    const select = await screen.findByLabelText('Language')
    await userEvent.selectOptions(select, 'fil')
    expect(await screen.findByRole('button', { name: 'Mga abiso, 2 hindi pa nababasa' })).toBeInTheDocument()
  })
})
