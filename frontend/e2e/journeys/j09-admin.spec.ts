import { expect, test, type Page } from '@playwright/test'
import { expectAccessible, expectNoAccess, go, heading, open, switchRole } from '../support/app'

/**
 * J9 — Admin assigns a production role (design.md › User journeys).
 *
 *   SCR-070 Users → SCR-071 Edit: roles and scope → save → the user is listed
 *   with the new role; SCR-072 shows the RBAC matrix; SCR-073 records the
 *   role change (P7) with the acting user and their active role (P12).
 *
 * Also: non-admins (Planner) get "No access" to the user screens; the Rules
 * Steward reads the audit log limited to data and rules events.
 *
 * Gap: "user notified" — the mock API records the audit event but raises no
 * notification for the edited user, and "next sign-in shows the role" needs a
 * real Cognito session (demo mode always lets users switch). See the fixme.
 */

const main = (page: Page) => page.getByRole('main')
const usersTable = (page: Page) => page.getByRole('table', { name: 'Users with their roles, data scope, last sign-in and status' })
const auditTable = (page: Page) => page.getByRole('table', { name: 'Audit events, newest first' })
const userRow = (page: Page, name: string) => usersTable(page).getByRole('row').filter({ has: page.getByRole('rowheader', { name, exact: true }) })

test.describe('J9 — Admin assigns a production role', () => {
  test('edit roles and scope → listed with the role → roles matrix → audit shows the change with user + active role', async ({ page }) => {
    // ── SCR-070 Users ──────────────────────────────────────────────────────
    await open(page, '/admin/users', 'ADM')
    await expect(heading(page)).toHaveText('Users')
    await expect(main(page).getByText(/Demo mode is on/)).toBeVisible()
    const santos = userRow(page, 'R. Santos')
    await expect(santos).toBeVisible()
    await expect(santos.getByText('Finance')).toBeVisible()
    await expect(santos.getByText('Executive')).toHaveCount(0)
    await expectAccessible(page)

    // ── SCR-071 Edit roles and scope ───────────────────────────────────────
    await santos.getByRole('link', { name: 'Edit R. Santos' }).or(santos.getByRole('button', { name: 'Edit R. Santos' })).click()
    await expect(heading(page)).toHaveText('Edit user: R. Santos')
    await expect(page.getByRole('checkbox', { name: 'Finance' })).toBeChecked()
    await expect(page.getByRole('radio', { name: 'Global' })).toBeChecked()
    await expectAccessible(page)

    await page.getByRole('checkbox', { name: 'Executive' }).check()
    // Narrow the scope to a region: a region must be chosen before saving.
    await page.getByRole('radio', { name: 'Region' }).check()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Choose at least one region.')).toBeVisible()
    await page.getByRole('group', { name: 'Regions' }).getByRole('checkbox', { name: 'Luzon' }).check()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Changes to R. Santos saved.').first()).toBeVisible()

    // ── Listed with the new role and scope ─────────────────────────────────
    if (!/\/admin\/users$/.test(new URL(page.url()).pathname)) await go(page, '/admin/users')
    await expect(heading(page)).toHaveText('Users')
    const updated = userRow(page, 'R. Santos')
    await expect(updated.getByText('Executive')).toBeVisible()
    await expect(updated.getByText('Finance')).toBeVisible()
    await expect(updated.getByText('Luzon')).toBeVisible()
    await expectAccessible(page)

    // ── SCR-072 Roles and permissions ──────────────────────────────────────
    await go(page, '/admin/roles')
    await expect(heading(page)).toHaveText('Roles and permissions')
    const matrix = page.getByRole('table', { name: 'Permission matrix: capabilities by role' })
    const usersRow = matrix.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Users and roles (SCR-070–072)' }) })
    await expect(usersRow.getByText('M', { exact: true })).toBeVisible()
    await expectAccessible(page)

    // ── SCR-073 Audit: the role change, by whom, in which active role ──────
    await go(page, '/admin/audit')
    await expect(heading(page)).toHaveText('Audit log')
    const change = auditTable(page).getByRole('row').filter({ hasText: 'user.access_updated' }).filter({ hasText: 'R. Santos' })
    await expect(change).toHaveCount(1)
    await expect(change).toContainText('Juan dela Cruz')
    await expect(change).toContainText('as System Admin')
    await expect(change).toContainText(/EXE/)
    await expectAccessible(page)
  })

  test.fixme('the edited user is notified and their next sign-in shows the role', async () => {
    // Not implemented in the mock API (no notification is raised for a role
    // change) and needs a real Cognito sign-in to observe the next session.
  })

  test('non-admins get No access to users; the Rules Steward sees data and rules audit events only', async ({ page }) => {
    await open(page, '/admin/users', 'PLN')
    await expectNoAccess(page)
    await expectAccessible(page)
    await go(page, '/admin/roles')
    await expectNoAccess(page)
    await go(page, '/admin/audit')
    await expectNoAccess(page)

    await switchRole(page, 'RST')
    await go(page, '/admin/users')
    await expectNoAccess(page)
    await go(page, '/admin/audit')
    await expect(heading(page)).toHaveText('Audit log')
    await expect(main(page).getByText('Rules Stewards see data and rules events only.')).toBeVisible()
    await expect(auditTable(page).getByText('rule_version.published')).toBeVisible()
    await expect(auditTable(page).getByText('dataset.loaded')).toBeVisible()
    await expect(auditTable(page)).not.toContainText('user.invited')
    await expect(auditTable(page)).not.toContainText('scenario.submitted')
    await expect(main(page).getByRole('button', { name: 'Export CSV' })).toHaveCount(0)
    const types = await page.getByRole('combobox', { name: 'Event type' }).getByRole('option').allTextContents()
    expect(types).not.toContain('Users and roles')
    await expectAccessible(page)
  })
})
