import { expect, test, type Page } from '@playwright/test'
import { expectAccessible, expectNoAccess, heading, open } from '../support/app'

/**
 * J4 — Store manager handles an emergency off (design.md "User journeys").
 * SCR-022 Weekly roster for the manager's own store (published) → shift cell
 * → Emergency off / reassign → ranked replacements with their rule impact →
 * pick a replacement (a labor-rule warning needs a reason, P14) → saved,
 * marked ✎ and listed under "Changes"; the no-cover branch leaves the shift
 * open. Scope (P1): the Store Manager sees only their own store; Staff has no
 * access to SCR-022.
 */

const ROSTER = /roster, mon, dec 14 to sun, dec 20/i
/** The demo network's other stores (outside the Store Manager's scope). */
const OTHER_STORES = /Mall of Asia|Las Piñas|Cebu City|Iloilo|Davao/

async function openRoster(page: Page) {
  await open(page, '/plan/roster', 'STM')
  await expect(heading(page)).toHaveText('Weekly roster')
  const grid = page.getByRole('table', { name: ROSTER })
  await expect(grid).toBeVisible()
  return grid
}

/** Opens the shift editor on a cell and switches to the emergency-off tab. */
async function emergencyOff(page: Page, shift: RegExp) {
  await page.getByRole('button', { name: shift }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('tab', { name: 'Emergency off / reassign' }).click()
  await expect(dialog.getByRole('group', { name: 'Replacement (eligible first)' })).toBeVisible()
  return dialog
}

/**
 * axe at the top of the page: after clicking a grid cell further down, the
 * sticky top bar covers controls near the top, which axe reports as
 * target-size (obscured) although scrolling reveals them.
 */
async function axe(page: Page, include?: string) {
  await page.evaluate(() => window.scrollTo(0, 0))
  await expectAccessible(page, include)
}

const changes = (page: Page) => page.getByRole('region', { name: 'Changes to the published roster' })

test.describe('J4 emergency off (SCR-022, Store Manager)', () => {
  test('own published store only; replacement that passes the rules saves with ✎ and an audit line', async ({ page }) => {
    const grid = await openRoster(page)

    // P1 scope: the store picker offers only the manager's own store.
    const store = page.getByRole('group', { name: 'Plan context and filters' }).getByLabel('Store', { exact: true })
    const storeIds = await store.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean))
    expect(storeIds).toEqual(['st-qc'])
    await expect(store.locator('option', { hasText: 'SM Supermarket – Quezon City' })).toHaveCount(1)
    await expect(store.locator('option', { hasText: OTHER_STORES })).toHaveCount(0)
    await expect(changes(page)).toContainText('No changes since the roster was published.')
    await axe(page)

    // Dina Rusel (FT-09) calls in sick on Monday.
    const dialog = await emergencyOff(page, /^FT-09 Dina Rusel, Mon, Dec 14/)
    await expect(dialog).toHaveAccessibleName('FT-09 Dina Rusel')
    // Ranked: eligible first; a 7th day in a row (no 24-hour rest) is blocked and not selectable.
    const radios = dialog.getByRole('radio')
    await expect(radios.first()).toBeChecked()
    await expect(radios.first()).toHaveAccessibleName(/eligible/)
    await expect(dialog.getByRole('radio', { name: /FT-07 Ralph Edu.*blocked/ })).toBeDisabled()
    await expect(dialog.getByRole('radio', { name: 'Find cover from nearby stores' })).toBeVisible()
    await axe(page, '[role="dialog"]')

    const replacement = (await radios.first().getAttribute('value')) ?? ''
    expect(replacement).not.toBe('')
    await dialog.getByLabel('Reason', { exact: true }).selectOption('sickCall')
    await dialog.getByRole('button', { name: 'Mark emergency off' }).click()

    await expect(dialog).toBeHidden()
    await expect(page.getByText('Change saved. The affected cashiers were notified.').first()).toBeVisible()
    await expect(changes(page).getByRole('listitem')).toHaveCount(1)
    await expect(changes(page)).toContainText(/Emergency off · Demo STM/)
    // Dina no longer works Monday; the replacement's cell is marked edited (✎).
    await expect(grid.getByRole('button', { name: /^FT-09 Dina Rusel, Mon, Dec 14/ })).toHaveCount(0)
    await expect(grid.locator('.lw-edited')).toHaveCount(1)
    await axe(page)
  })

  test('a replacement that breaks a labor rule needs a reason before saving (P14)', async ({ page }) => {
    await openRoster(page)
    // Arlene Mac (PT-06) works Fri 5–9 PM. Dina Rusel ends at 5 PM that day and is at the
    // FT weekly cap: she can cover, but only with a recorded reason.
    const dialog = await emergencyOff(page, /^PT-06 Arlene Mac, Fri, Dec 18/)
    const risky = dialog.getByRole('radio', { name: /FT-09 Dina Rusel.*breaks a labor rule/ })
    await expect(risky).toBeEnabled()
    await risky.check()

    const reason = dialog.getByLabel(/Reason for overriding the labor rule/)
    const confirm = dialog.getByRole('button', { name: 'Mark emergency off' })
    await expect(reason).toBeVisible()
    await expect(confirm).toBeDisabled()
    await axe(page, '[role="dialog"]')

    await reason.fill('No other trained cashier free on Friday evening')
    await expect(confirm).toBeEnabled()
    await confirm.click()

    await expect(dialog).toBeHidden()
    await expect(changes(page)).toContainText(/Emergency off · Demo STM/)
    await expect(changes(page)).toContainText('Reason: No other trained cashier free on Friday evening')
    await expect(page.getByRole('button', { name: /^PT-06 Arlene Mac, Fri, Dec 18/ })).toHaveCount(0)
    await axe(page)
  })

  // Product gap: the week grid shows one shift per cashier per day (adapt.gridRows), so the
  // replacement's second Friday shift (5–9 PM, after her own 8 AM–5 PM) is saved but not shown.
  test.fixme('the replacement\'s added shift shows in the grid even when they already work that day', async ({ page }) => {
    await openRoster(page)
    const dialog = await emergencyOff(page, /^PT-06 Arlene Mac, Fri, Dec 18/)
    await dialog.getByRole('radio', { name: /FT-09 Dina Rusel/ }).check()
    await dialog.getByLabel(/Reason for overriding the labor rule/).fill('Cover')
    await dialog.getByRole('button', { name: 'Mark emergency off' }).click()
    await expect(page.getByRole('button', { name: /^FT-09 Dina Rusel, Fri, Dec 18, 5:00 PM/ })).toBeVisible()
  })

  test('no cover: the shift is left unfilled as an open shift', async ({ page }) => {
    const grid = await openRoster(page)
    const openRow = grid.getByRole('row', { name: /Open shifts/ })
    const before = await openRow.getByRole('button').count()

    const dialog = await emergencyOff(page, /^FT-09 Dina Rusel, Mon, Dec 14/)
    await dialog.getByRole('radio', { name: 'Find cover from nearby stores' }).check()
    await dialog.getByLabel('Reason', { exact: true }).selectOption('family')
    await dialog.getByRole('button', { name: 'Mark emergency off' }).click()

    await expect(dialog).toBeHidden()
    await expect(changes(page)).toContainText(/Emergency off · Demo STM/)
    await expect(grid.getByRole('button', { name: /^FT-09 Dina Rusel, Mon, Dec 14/ })).toHaveCount(0)
    await expect(openRow.getByRole('button')).toHaveCount(before + 1)
    await expect(openRow.getByRole('button', { name: /Mon, Dec 14/ })).toBeVisible()
    await axe(page)
  })

  test('Staff has no access to the weekly roster', async ({ page }) => {
    await open(page, '/plan/roster', 'STF')
    await expectNoAccess(page)
    await expect(page.getByRole('table', { name: ROSTER })).toHaveCount(0)
    await axe(page)
  })
})
