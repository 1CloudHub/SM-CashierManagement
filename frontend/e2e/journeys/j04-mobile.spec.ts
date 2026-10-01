import { expect, test, type Page } from '@playwright/test'
import { expectAccessible, heading, open } from '../support/app'

/**
 * J4 on a phone: "On mobile only the emergency off and replacement are
 * available" (design.md J4, requirement 6.5 / 24.2). The Store Manager's
 * week is a list of day cards whose only action is "Emergency off /
 * reassign"; the shift editor opens on that tab with "Edit shift" disabled
 * and no "Remove shift". Axe runs on the phone layout.
 */

async function axe(page: Page, include?: string) {
  // Controls near the top sit under the sticky top bar once the list is scrolled.
  await page.evaluate(() => window.scrollTo(0, 0))
  await expectAccessible(page, include)
}

test.describe('J4 emergency off on a phone (Store Manager)', () => {
  // The laptop project matches every spec; this journey is about the phone layout.
  test.skip(({ isMobile }) => !isMobile, 'Phone layout only (run with --project=phone)')

  test('only emergency off / reassign is offered; the replacement is saved', async ({ page }) => {
    await open(page, '/plan/roster', 'STM')
    await expect(heading(page)).toHaveText('Weekly roster')
    const monday = page.getByRole('region', { name: /Mon, Dec 14/ })
    await expect(monday).toBeVisible()
    await expect(page.getByText('Read-only on a phone except emergency off. Edit other changes on a larger screen.').first()).toBeVisible()

    // Every shift action in the day cards is "Emergency off / reassign"; no add / edit / remove.
    const days = page.locator('section[aria-labelledby]').filter({ has: page.getByRole('heading', { name: /, Dec \d+/ }) })
    const actions = days.getByRole('button')
    expect(await actions.count()).toBeGreaterThan(0)
    for (const name of await actions.evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label') ?? b.textContent ?? ''))) {
      expect(name).toMatch(/^Emergency off \/ reassign/)
    }
    await expect(page.getByRole('button', { name: /Add shift/ })).toHaveCount(0)
    await expect(page.getByRole('table', { name: /roster, mon, dec 14/i })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await axe(page)

    await monday.getByRole('button', { name: /^Emergency off \/ reassign — FT-09 Dina Rusel/ }).click()
    const dialog = page.getByRole('dialog', { name: 'FT-09 Dina Rusel' })
    await expect(dialog.getByRole('tab', { name: 'Edit shift' })).toBeDisabled()
    await expect(dialog.getByRole('tab', { name: 'Emergency off / reassign' })).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.getByRole('button', { name: 'Remove shift' })).toHaveCount(0)
    const first = dialog.getByRole('radio').first()
    await expect(first).toBeChecked()
    await expect(first).toHaveAccessibleName(/eligible/)
    await expect(dialog.getByRole('radio', { name: /FT-07 Ralph Edu.*blocked/ })).toBeDisabled()
    await expectAccessible(page, '[role="dialog"]')

    await dialog.getByRole('button', { name: 'Mark emergency off' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText('Change saved. The affected cashiers were notified.').first()).toBeVisible()
    await expect(page.getByRole('region', { name: 'Changes to the published roster' })).toContainText(/Emergency off · Demo STM/)
    await expect(monday.getByRole('button', { name: /^Emergency off \/ reassign — FT-09 Dina Rusel/ })).toHaveCount(0)
    await axe(page)
  })
})
