import { expect, test } from '@playwright/test'
import { expectAccessible, heading, open } from '../support/app'

/**
 * J8 on the cashier's phone (SCR-025 is phone-first): the "Your shift
 * changed" notification leads to My roster, which shows only their own
 * shifts (P11) and saves them to the calendar. Axe on the phone layout.
 */
test.describe('J8 Staff checks their roster on a phone', () => {
  // The laptop project matches every spec; this journey is about the phone layout.
  test.skip(({ isMobile }) => !isMobile, 'Phone layout only (run with --project=phone)')

  test('notification → My roster (own shifts only) → Add to calendar', async ({ page }) => {
    await open(page, '/', 'STF')
    await page.getByRole('button', { name: /^Notifications/ }).click()
    const changed = page.getByRole('region', { name: 'Latest notifications' }).getByRole('link', { name: /Your shift changed/ })
    await expect(changed).toBeVisible()
    await changed.click()
    await expect(page).toHaveURL(/\/my-roster$/)
    await expect(heading(page)).toHaveText('My roster')

    const week = page.getByRole('list', { name: /Dec 14/ })
    await expect(week.getByRole('listitem')).toHaveCount(7)
    const sat = week.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Sat, Dec 19' }) })
    await expect(sat).toContainText('12:00 PM – 9:00 PM')
    const main = await page.getByRole('main').innerText()
    expect(main).not.toMatch(/Isa Palma|Ana Reyes|Ralph Edu|Dina Rusel|Arlene Mac|Cam Wills/)
    expect(main).not.toContain('₱')
    // Nothing overflows sideways on the phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await expectAccessible(page)

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Add to calendar' }).click()])
    expect(download.suggestedFilename()).toBe('lanewise-shifts-2026-12-14.ics')
    await expect(page.getByText(/Calendar file saved with 3 shifts/).first()).toBeVisible()
  })
})
