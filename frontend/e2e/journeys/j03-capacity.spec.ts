import { expect, test, type Page } from '@playwright/test'
import { expectAccessible, expectNoAccess, go, heading, open, switchRole } from '../support/app'

/**
 * J3 — Planner investigates lane-capacity pressure (design.md › User journeys).
 *
 *   Home "3 departments over capacity on Dec 24" → SCR-020 network view sorted
 *   by capacity pressure → heatmap row (Cebu main lanes) → SCR-021 department
 *   day plan with the over-capacity tag → settings (service target / min
 *   lanes): a published scenario is read-only and offers "Duplicate as draft";
 *   the draft recalculates in place → back to the day plan (on the published
 *   scenario: the mock cannot yet open a new draft there, see the gap note).
 *
 * Also: scope (P1) — a Store Manager sees only their own store, Staff and
 * Admin get "No access"; cost visibility (Req 25) — ₱ shown to Planner and
 * Finance, hidden from the Rules Steward on the screens it can see.
 *
 * Note: the mock planning engine does not re-size lanes from the scenario
 * settings, so the journey asserts the recalculation happened (run complete,
 * day plan now from the draft) rather than changed lane figures.
 */

/** A ₱ amount (not the "Cost ₱" column header). */
const PESO_AMOUNT = /₱\s?\d/

const main = (page: Page) => page.getByRole('main')
const staffingTable = (page: Page) => page.getByRole('table', { name: 'Staffing plan by store and department' })
const heatmap = (page: Page) => page.getByRole('table', { name: 'Lane-capacity pressure by department and hour' })

/** Waits for SCR-020 to finish loading its figures. */
async function networkReady(page: Page) {
  await expect(heading(page)).toHaveText('All stores and departments')
  await expect(staffingTable(page)).toBeVisible()
}

test.describe('J3 — Planner investigates lane-capacity pressure', () => {
  test('Home over-capacity alert → network view sorted by pressure → heatmap → department day plan with over-capacity tag', async ({ page }) => {
    // ── Home: the over-capacity alert ─────────────────────────────────────
    await open(page, '/', 'PLN')
    const attention = page.getByRole('region', { name: 'Needs attention' })
    const overItem = attention.getByRole('listitem').filter({ hasText: '3 departments over lane capacity on Dec 24' })
    await expect(overItem).toBeVisible()
    await expectAccessible(page)

    // ── SCR-020 Network view, on the date the alert names ─────────────────
    await overItem.getByRole('link', { name: 'Network view' }).click()
    await expect(page).toHaveURL(/\/plan\/network\?.*date=2026-12-24/)
    await networkReady(page)
    await expect(main(page).getByText('Thursday, December 24, 2026')).toBeVisible()
    const overAlert = page.getByRole('note').filter({ hasText: 'Over installed lanes' })
    await expect(overAlert.getByRole('link', { name: /SM Supermarket – Cebu City · Main checkout lanes: needs \d+, has 20/ })).toBeVisible()
    // Cost is visible to the Planner (Req 25).
    await expect(main(page).getByText('Roster cost')).toBeVisible()
    await expect(main(page)).toContainText(PESO_AMOUNT)
    await expectAccessible(page)

    // Sort by capacity pressure: the most pressured store (Cebu) comes first.
    await page.getByLabel('Sort').selectOption('pressure')
    await expect(page).toHaveURL(/sort=pressure/)
    const firstStore = staffingTable(page).getByRole('rowgroup').nth(1).getByRole('row').first()
    await expect(firstStore.getByRole('rowheader')).toHaveText('SM Supermarket – Cebu City')
    await expect(staffingTable(page).getByRole('rowheader', { name: /Main checkout lanes Over capacity \+\d+/ }).first()).toBeVisible()

    // ── Heatmap: Cebu main lanes (values printed, band announced) ─────────
    const cebuMain = heatmap(page).getByRole('row', { name: /^SM Supermarket – Cebu City · Main checkout lanes/ })
    await expect(cebuMain.getByRole('cell').filter({ hasText: /over capacity, \d+% of installed lanes/ }).first()).toBeVisible()
    await cebuMain.getByRole('link', { name: 'SM Supermarket – Cebu City · Main checkout lanes' }).click()

    // ── SCR-021 Department day plan with the over-capacity tag ────────────
    await expect(page).toHaveURL(/\/plan\/department\?.*dept=st-cebu-d1.*date=2026-12-24/)
    await expect(heading(page)).toHaveText('Main checkout lanes — SM Supermarket – Cebu City')
    await page.getByRole('button', { name: 'View as table' }).first().click()
    const hourly = page.getByRole('table', { name: 'Hour-by-hour staffing plan' })
    await expect(hourly.getByText('Over capacity').first()).toBeVisible()
    await expect(main(page).getByText('Labor cost')).toBeVisible()
    await expect(main(page)).toContainText(PESO_AMOUNT)
    await expect(main(page).getByText(/From Christmas 2026 v3 \(Published\)/)).toBeVisible()
    await expectAccessible(page)
  })

  test('department day plan → settings: published prompts "Duplicate as draft"; the draft recalculates in place', async ({ page }) => {
    await open(page, '/plan/department?store=st-cebu&dept=st-cebu-d1&date=2026-12-24', 'PLN')
    await expect(heading(page)).toHaveText('Main checkout lanes — SM Supermarket – Cebu City')
    await expect(main(page).getByText(/From Christmas 2026 v3 \(Published\)/)).toBeVisible()

    // ── Settings: the published scenario is read-only → duplicate as draft ─
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'All scenarios' }).click()
    await expect(heading(page)).toHaveText('Scenarios')
    await main(page).getByRole('link', { name: 'Christmas 2026 v3', exact: true }).first().click()
    await expect(page).toHaveURL(/\/scenarios\/scn-xmas-2026-v3\/settings/)
    await expect(heading(page)).toHaveText('Christmas 2026 v3')
    await expect(page.getByText('This scenario is read-only')).toBeVisible()
    await expect(page.getByLabel('Minimum open lanes')).toBeDisabled()
    await expectAccessible(page)

    await page.getByRole('button', { name: 'Duplicate as draft' }).click()
    await expect(page).not.toHaveURL(/scn-xmas-2026-v3\//)
    await expect(page).toHaveURL(/\/scenarios\/[^/]+\/settings/)
    const draftId = /\/scenarios\/([^/]+)\/settings/.exec(page.url())?.[1] ?? ''
    expect(draftId).not.toBe('')
    await expect(main(page).getByText('Draft', { exact: true }).first()).toBeVisible()
    await expect(heading(page)).toHaveText('Christmas 2026 v3 (copy)')

    // ── Draft: change service target and min lanes, recalculate in place ──
    const minLanes = page.getByLabel('Minimum open lanes')
    await expect(minLanes).toBeEnabled()
    await minLanes.fill('4')
    await page.getByLabel('Served within target (%)').fill('85')
    await expect(page.getByText(/^Edited/).first()).toBeVisible()
    await page.getByRole('button', { name: 'Save and run' }).click()
    await expect(main(page).getByText('Run complete', { exact: true })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/scenarios/${draftId}/settings`))
    await expect(minLanes).toHaveValue('4')
    await expectAccessible(page)

    // ── Back to the department day plan ───────────────────────────────────
    // Gap: the mock context options (GET /context-options) and planning views
    // only know the seeded scenarios, so the day plan cannot yet be opened on
    // a newly duplicated draft; the journey returns to the day plan as-is.
    await go(page, '/plan/department?store=st-cebu&dept=st-cebu-d1&date=2026-12-24')
    await expect(heading(page)).toHaveText('Main checkout lanes — SM Supermarket – Cebu City')
    await expectAccessible(page)
  })

  test('scope (P1): Store Manager sees only their store; Staff and Admin have no access', async ({ page }) => {
    await open(page, '/plan/network', 'STM')
    await networkReady(page)
    await expect(main(page).getByText(/^1 stores? · 3 departments$/)).toBeVisible()
    await expect(staffingTable(page).getByRole('rowheader', { name: 'SM Supermarket – Quezon City', exact: true })).toBeVisible()
    await expect(main(page)).not.toContainText('Cebu City')
    await expect(main(page)).not.toContainText('Mall of Asia')
    await expectAccessible(page)

    await switchRole(page, 'STF')
    await go(page, '/plan/network')
    await expectNoAccess(page)
    await expectAccessible(page)

    await switchRole(page, 'ADM')
    await go(page, '/plan/department')
    await expectNoAccess(page)
  })

  test('cost visibility (Req 25): Finance sees ₱, the Rules Steward does not', async ({ page }) => {
    await open(page, '/plan/network', 'FIN')
    await networkReady(page)
    await expect(main(page)).toContainText(PESO_AMOUNT)
    await expect(main(page).getByText('Hidden for your role')).toHaveCount(0)

    await switchRole(page, 'RST')
    await go(page, '/plan/network?date=2026-12-24')
    await networkReady(page)
    await expect(main(page).getByText('Hidden for your role').first()).toBeVisible()
    await expect(main(page)).not.toContainText(PESO_AMOUNT)
    await expectAccessible(page)

    await staffingTable(page).getByRole('link', { name: 'Main checkout lanes' }).first().click()
    await expect(heading(page)).toHaveText(/^Main checkout lanes — /)
    await expect(main(page).getByText('Labor cost')).toBeVisible()
    await expect(main(page).getByText('Hidden for your role').first()).toBeVisible()
    await expect(main(page)).not.toContainText(PESO_AMOUNT)
    await expectAccessible(page)
  })
})
