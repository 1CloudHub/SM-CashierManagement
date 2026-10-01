import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { expectAccessible, expectNoAccess, go, heading, open, switchRole } from '../support/app'

/**
 * J5 — HR works the recruiting timeline (design.md › User journeys).
 *
 *   Notification "milestone due within 7 days" → SCR-023 Hiring plan "When to
 *   act" timeline → filter region → export hires by store and department
 *   (CSV download) → SCR-053 Staff: add the new hires and their availability.
 *
 * Roles: HR full (view + export, manages staff); Store Manager sees only their
 * own store (P1); Staff has no access (P12).
 *
 * Gaps (reported, see fixmes):
 *  - the Region/Format filters in the hiring plan's context bar are kept in
 *    the URL but not applied: the hiring-plan request takes no filter, so the
 *    stores listed do not change;
 *  - the "milestone due within 7 days" notification has no matching
 *    "Due within 7 days" milestone on the timeline (demo data mismatch);
 *  - "import new hires" from a file is offered only to the Rules Steward
 *    (SCR-051, data_ingestion manage); HR adds hires one by one on SCR-053.
 */

const main = (page: Page) => page.getByRole('main')
const team = (page: Page) => page.getByRole('table', { name: 'Team by store and department' })

async function hiringReady(page: Page) {
  await expect(heading(page)).toHaveText('Hiring plan')
  await expect(page.getByRole('heading', { name: 'When to act' })).toBeVisible()
}

test.describe('J5 — HR works the recruiting timeline', () => {
  test('notification → When to act timeline → region filter → export CSV → staff: add a new hire', async ({ page }) => {
    // ── Notification: a hiring milestone is due ────────────────────────────
    await open(page, '/notifications', 'HR')
    await expect(heading(page)).toHaveText('Notifications')
    const due = main(page).getByRole('row').filter({ hasText: /Hiring milestone due within 7 days — Christmas 2026 v3/ })
    await expect(due).toHaveCount(1)
    await expect(due).toContainText('Unread')
    await expectAccessible(page)
    await due.getByRole('link', { name: 'Open' }).click()

    // ── SCR-023 Hiring plan: the "When to act" timeline ────────────────────
    await expect(page).toHaveURL(/\/plan\/hiring/)
    await hiringReady(page)
    const timeline = page.getByRole('region', { name: 'When to act' })
    // Each milestone shows its date, a status in words and the hires it covers.
    // Gap: the seeded "milestone due within 7 days" notification has no
    // matching "Due within 7 days" milestone on this timeline (first is Oct 19).
    const milestones = timeline.getByRole('listitem')
    await expect(milestones.first()).toContainText(/\w{3} \d{1,2}, \d{4}/)
    await expect(milestones.first()).toContainText(/Overdue|Due within 7 days|Upcoming|Done/)
    await expect(timeline.getByText(/— (Full-time|Part-time|Float), \d+ hires/).first()).toBeVisible()
    await expect(team(page).getByRole('rowheader', { name: 'SM Supermarket – Cebu City' })).toBeVisible()
    // HR sees cost (Req 25) and has no Run/Recalculate (planner only).
    await expect(main(page)).toContainText(/₱\s?\d/)
    await expect(main(page).getByRole('button', { name: /Run hiring plan|Recalculate/ })).toHaveCount(0)
    await expectAccessible(page)

    // ── Filter: region ─────────────────────────────────────────────────────
    await page.getByLabel('Region').selectOption({ label: 'Visayas' })
    await expect(page).toHaveURL(/region=/)
    await hiringReady(page)
    await expectAccessible(page)

    // ── Export hires by store and department ───────────────────────────────
    const [download] = await Promise.all([page.waitForEvent('download'), main(page).getByRole('button', { name: 'Export CSV' }).click()])
    expect(download.suggestedFilename()).toBe('hiring-plan.csv')
    const csv = await readFile(await download.path(), 'utf8')
    expect(csv).toContain('SM Supermarket – Cebu City')
    expect(csv.split('\n').length).toBeGreaterThan(2)

    // ── SCR-053 Staff: add a new hire and see their availability ───────────
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Staff and availability' }).click()
    await expect(heading(page)).toHaveText('Staff and availability')
    await expect(main(page).getByRole('link', { name: 'Import from HRIS / file' })).toHaveCount(0)
    await expectAccessible(page)
    await main(page).getByRole('button', { name: '+ Staff' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add staff' })
    await dialog.getByLabel(/^Staff ID/).fill('SE-41')
    await dialog.getByLabel(/^Name/).fill('Lorna Bautista')
    await dialog.getByLabel('Type').selectOption({ label: 'Seasonal' })
    await expectAccessible(page, '[role="dialog"]')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Staff SE-41 added.').first()).toBeVisible()
    const newHire = main(page).getByRole('button', { name: /^SE-41 ?, availability for Lorna Bautista$/ })
    await expect(newHire).toBeVisible()
    await newHire.click()
    const record = page.getByRole('dialog', { name: 'SE-41 availability' })
    await expect(record.getByRole('heading', { name: 'Weekly availability' })).toBeVisible()
    await expectAccessible(page, '[role="dialog"]')
  })

  test.fixme('the region filter narrows the hiring plan to that region’s stores', async ({ page }) => {
    // Not implemented: the SCR-023 context bar stores region/format in the URL,
    // but `PlanningClient.hiringPlan(scenarioId)` sends no filter.
    await open(page, '/plan/hiring?region=visayas', 'HR')
    await hiringReady(page)
    await expect(team(page).getByRole('rowheader', { name: 'SM Supermarket – Quezon City' })).toHaveCount(0)
  })

  test.fixme('HR imports new hires and availability from a file', async () => {
    // Not offered to HR: "Import from HRIS / file" (SCR-051) needs
    // data_ingestion manage, which only the Rules Steward has.
  })

  test('scope (P1): Store Manager sees only their store; Staff has no access', async ({ page }) => {
    await open(page, '/plan/hiring', 'STM')
    await hiringReady(page)
    await expect(team(page).getByRole('rowheader', { name: 'SM Supermarket – Quezon City', exact: true })).toBeVisible()
    await expect(main(page)).not.toContainText('Cebu City')
    await expect(main(page)).not.toContainText('Mall of Asia')
    await expect(main(page).getByRole('button', { name: 'Export CSV' })).toHaveCount(0)
    await expectAccessible(page)

    await go(page, '/data/staff')
    await expect(heading(page)).toHaveText('Staff and availability')
    await expect(main(page).getByRole('button', { name: '+ Staff' })).toHaveCount(0)

    await switchRole(page, 'STF')
    await go(page, '/plan/hiring')
    await expectNoAccess(page)
    await expectAccessible(page)
    await go(page, '/data/staff')
    await expectNoAccess(page)
  })
})
