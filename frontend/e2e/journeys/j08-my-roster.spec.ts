import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { expectAccessible, expectNoAccess, go, heading, open, switchRole } from '../support/app'

/**
 * J8 — Staff checks their roster (design.md "User journeys").
 * The store manager changes the cashier's Saturday shift on SCR-022 → the
 * Staff user gets "Your shift changed" → SCR-025 My roster shows the new time,
 * the old one and who changed it → "Add to calendar" downloads an .ics of
 * their own shifts. P11: only their own shifts — no other cashier's name and
 * no ₱ cost; Staff has no access to the planning and staff screens.
 */

/** Every other cashier on the demo Quezon City roster (P11). */
const OTHER_CASHIERS = /Isa Palma|Ana Reyes|Ralph Edu|Dina Rusel|Arlene Mac|Cam Wills|FT-01|FT-03|FT-07|FT-09|PT-06|FL-01/

async function expectOwnShiftsOnly(page: Page) {
  const main = await page.getByRole('main').innerText()
  expect(main).not.toMatch(OTHER_CASHIERS)
  expect(main).not.toContain('₱')
  await expect(page.getByText('You see only your own shifts — no other names or costs.')).toBeVisible()
}

test.describe('J8 Staff checks their roster (SCR-025)', () => {
  test('a shift change by the store manager → notification → My roster shows the new time and who changed it → Add to calendar', async ({ page }) => {
    // The store manager moves Juan dela Cruz's (PT-02) Saturday shift: 12–9 PM → 1–9 PM.
    await open(page, '/plan/roster', 'STM')
    await page.getByRole('button', { name: /^PT-02 Juan dela Cruz, Sat, Dec 19/ }).click()
    const editor = page.getByRole('dialog', { name: 'PT-02 Juan dela Cruz' })
    await editor.getByLabel('Start', { exact: true }).selectOption(String(13 * 60))
    await expect(editor.getByText('Passes every labor rule')).toBeVisible()
    await editor.getByRole('button', { name: 'Save shift' }).click()
    await expect(editor).toBeHidden()
    await expect(page.getByRole('region', { name: 'Changes to the published roster' })).toContainText(/Time changed · Demo STM/)

    // The cashier opens the notification.
    await switchRole(page, 'STF')
    await go(page, '/')
    const bell = page.getByRole('button', { name: /^Notifications/ })
    await bell.click()
    const latest = page.getByRole('region', { name: 'Latest notifications' })
    const changed = latest.getByRole('link', { name: /Your shift changed/ })
    await expect(changed).toBeVisible()
    await expectAccessible(page)
    await changed.click()
    await expect(page).toHaveURL(/\/my-roster$/)
    await expect(heading(page)).toHaveText('My roster')

    // New time, previous time and who changed it.
    await expect(page.getByText(/Juan dela Cruz \(PT-02\) · SM Supermarket – Quezon City/)).toBeVisible()
    await expect(page.getByText(/Sat, Dec 19 changed from 12:00 PM – 9:00 PM to 1:00 PM – 9:00 PM by Demo STM/)).toBeVisible()
    const week = page.getByRole('list', { name: /Dec 14/ })
    const sat = week.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Sat, Dec 19' }) })
    await expect(sat).toContainText('1:00 PM – 9:00 PM')
    await expect(sat).toContainText('Changed')
    await expect(sat).toContainText('Was 12:00 PM – 9:00 PM')
    await expect(week.getByText('Rest day')).toHaveCount(4)

    // P11: own shifts only — no other names, no cost.
    await expectOwnShiftsOnly(page)
    await expectAccessible(page)

    // Add to calendar: an .ics of their own shifts, with the new Saturday time.
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Add to calendar' }).click()])
    expect(download.suggestedFilename()).toMatch(/^lanewise-shifts-2026-12-14\.ics$/)
    const ics = await readFile((await download.path()) ?? '', 'utf8')
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3)
    expect(ics).toContain('DTSTART:20261219T050000Z') // Sat Dec 19, 1 PM Manila
    expect(ics).toContain('LOCATION:SM Supermarket – Quezon City')
    expect(ics).not.toMatch(OTHER_CASHIERS)
    await expect(page.getByText(/Calendar file saved with 3 shifts/).first()).toBeVisible()
  })

  test('Staff has no access to the weekly roster, network view or staff records', async ({ page }) => {
    await open(page, '/my-roster', 'STF')
    await expect(heading(page)).toHaveText('My roster')
    for (const path of ['/plan/roster', '/plan/network', '/data/staff']) {
      await go(page, path)
      await expectNoAccess(page)
    }
    await expectAccessible(page)
  })
})
