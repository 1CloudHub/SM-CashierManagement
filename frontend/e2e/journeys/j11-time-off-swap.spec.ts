import { expect, test, type Page } from '@playwright/test'
import { expectAccessible, go, heading, open, switchRole } from '../support/app'

/**
 * J11 — Staff time-off / swap request (design.md "User journeys").
 * Staff raises a time-off request (dates + reason) and a swap on SCR-025 →
 * P19: the published roster is unchanged while they are pending → the store
 * manager decides in the SCR-022 Requests panel: decline with a comment (the
 * cashier sees "Declined", roster unchanged) or approve (time off → the
 * cashier's shifts become open and are flagged; swap → a ShiftOverride ✎,
 * both notified). One page session, handing over with the role switcher.
 */

const ROSTER = /roster, mon, dec 14 to sun, dec 20/i
const ME = 'PT-02 Juan dela Cruz'

const panel = (page: Page) => page.locator('details').filter({ hasText: /Staff requests — \d+ pending/ })
const changes = (page: Page) => page.getByRole('region', { name: 'Changes to the published roster' })
const myRequests = (page: Page) => page.getByRole('region', { name: 'Requests' })

async function toRoster(page: Page) {
  await switchRole(page, 'STM')
  await go(page, '/plan/roster')
  await expect(page.getByRole('table', { name: ROSTER })).toBeVisible()
}

async function toMyRoster(page: Page) {
  await switchRole(page, 'STF')
  await go(page, '/my-roster')
  await expect(heading(page)).toHaveText('My roster')
}

test.describe('J11 time-off and swap requests (SCR-025 → SCR-022)', () => {
  test('requests change nothing while pending (P19); decline with a comment; approve a swap and a time off', async ({ page }) => {
    // --- Staff raises a time-off request and a swap -------------------------------------------
    await open(page, '/my-roster', 'STF')
    await expect(myRequests(page)).toContainText('Your roster doesn’t change until they approve.')

    await page.getByRole('button', { name: 'Request time off' }).click()
    const timeOff = page.getByRole('dialog', { name: 'Request time off' })
    await timeOff.getByLabel(/^From/).fill('2026-12-17')
    await timeOff.getByLabel(/^To/).fill('2026-12-17')
    await timeOff.getByRole('combobox', { name: /Reason/ }).selectOption('medical')
    await expectAccessible(page, '[role="dialog"]')
    await timeOff.getByRole('button', { name: 'Send request' }).click()
    await expect(timeOff).toBeHidden()
    await expect(page.getByText('Request sent to your store manager.').first()).toBeVisible()

    await page.getByRole('button', { name: 'Request a swap' }).click()
    const swap = page.getByRole('dialog', { name: 'Request a swap' })
    const give = swap.getByRole('combobox', { name: /Give up my shift/ })
    await expect(give.locator('option', { hasText: 'Sat, Dec 19' })).toHaveCount(1)
    await give.selectOption({ label: (await give.locator('option', { hasText: 'Sat, Dec 19' }).textContent()) ?? '' })
    await expect(swap.getByRole('combobox', { name: /Take instead/ })).toContainText(/open shift Sat, Dec 19/)
    await swap.getByRole('textbox', { name: /Note/ }).fill('Exam in the morning')
    await expectAccessible(page, '[role="dialog"]')
    await swap.getByRole('button', { name: 'Send request' }).click()
    await expect(swap).toBeHidden()

    const week = page.getByRole('list', { name: /Dec 14/ })
    const day = (name: string) => week.getByRole('listitem').filter({ has: page.getByRole('heading', { name }) })
    await expect(day('Thu, Dec 17')).toContainText('Request pending')
    await expect(day('Sat, Dec 19')).toContainText('Request pending')
    await expect(myRequests(page).getByText('Pending · store manager')).toHaveCount(3) // + the seeded Dec 24 request
    await expectAccessible(page)

    // --- P19: the store manager's roster is unchanged while the requests are pending -----------
    await toRoster(page)
    const grid = page.getByRole('table', { name: ROSTER })
    await expect(grid.getByRole('button', { name: new RegExp(`^${ME}, Thu, Dec 17, 3:00 PM`) })).toBeVisible()
    await expect(grid.getByRole('button', { name: new RegExp(`^${ME}, Sat, Dec 19, 12:00 PM`) })).toBeVisible()
    await expect(changes(page)).toContainText('No changes since the roster was published.')
    const requests = panel(page)
    await expect(requests).toContainText('Staff requests — 4 pending')
    await expectAccessible(page)

    // --- Decline the time off with a comment -------------------------------------------------
    const timeOffRow = requests.getByRole('row').filter({ hasText: 'Time off' }).filter({ hasText: 'Dec 17' })
    await timeOffRow.getByRole('button', { name: `Decline request from ${ME}` }).click()
    const decline = page.getByRole('dialog', { name: `Decline request from ${ME}` })
    await decline.getByLabel('Comment to the cashier (optional)').fill('Two cashiers already off on Thursday')
    await expectAccessible(page, '[role="dialog"]')
    await decline.getByRole('button', { name: 'Decline' }).click()
    await expect(decline).toBeHidden()
    await expect(requests).toContainText(`Request from ${ME} declined.`)
    await expect(requests).toContainText('Staff requests — 3 pending')
    await expect(grid.getByRole('button', { name: new RegExp(`^${ME}, Thu, Dec 17, 3:00 PM`) })).toBeVisible()
    await expect(changes(page)).toContainText('No changes since the roster was published.')

    // --- Approve the swap: applied as a ShiftOverride (✎), both sides recorded ----------------
    const swapRow = requests.getByRole('row').filter({ hasText: 'Swap' }).filter({ hasText: ME })
    await swapRow.getByRole('button', { name: `Approve request from ${ME}` }).click()
    const approve = page.getByRole('dialog', { name: `Approve request from ${ME}` })
    await expect(approve).toContainText('The swap is applied to the roster as a change, and both cashiers are notified.')
    await approve.getByRole('button', { name: 'Approve' }).click()
    await expect(approve).toBeHidden()
    await expect(requests).toContainText(`Request from ${ME} approved.`)
    await expect(changes(page).getByText(/Swapped \(staff request\)/)).toHaveCount(2)
    await expect(grid.getByRole('button', { name: new RegExp(`^${ME}, Sat, Dec 19, 4:00 PM`) })).toBeVisible()

    // --- Approve a colleague's time off (PT-06, Wed Dec 16): the shift becomes open and flagged
    const banner = page.getByRole('region', { name: 'Open shifts' })
    // The swap filled the open 4–10 PM shift and left the given-up 12–9 PM shift open.
    await expect(banner).toContainText('1 open shifts')
    await expect(banner).toContainText('Sat, Dec 19, 12:00 PM – 9:00 PM')
    const pt06 = requests.getByRole('row').filter({ hasText: 'PT-06 Arlene Mac' })
    await expect(pt06).toContainText('Approving leaves 1 of their shifts open.')
    await pt06.getByRole('button', { name: 'Approve request from PT-06 Arlene Mac' }).click()
    const approveOff = page.getByRole('dialog', { name: 'Approve request from PT-06 Arlene Mac' })
    await expect(approveOff).toContainText('1 of their shifts become open and are flagged.')
    await approveOff.getByRole('button', { name: 'Approve' }).click()
    await expect(approveOff).toBeHidden()
    await expect(changes(page)).toContainText(/Left open by approved time off · Demo STM/)
    await expect(grid.getByRole('button', { name: /^PT-06 Arlene Mac, Wed, Dec 16/ })).toHaveCount(0)
    await expect(banner).toContainText('2 open shifts')
    await expect(banner).toContainText('Wed, Dec 16, 1:00 PM – 5:00 PM')
    await expectAccessible(page)

    // --- The cashier sees the outcome -----------------------------------------------------------
    await toMyRoster(page)
    const mine = myRequests(page)
    const declined = mine.getByRole('listitem').filter({ hasText: 'Declined' })
    await expect(declined).toContainText('Store manager: “Two cashiers already off on Thursday”')
    await expect(mine.getByRole('listitem').filter({ hasText: 'Swap' })).toContainText('Approved')
    const week2 = page.getByRole('list', { name: /Dec 14/ })
    const day2 = (name: string) => week2.getByRole('listitem').filter({ has: page.getByRole('heading', { name }) })
    await expect(day2('Thu, Dec 17')).toContainText('3:00 PM – 7:00 PM') // declined: unchanged
    await expect(day2('Thu, Dec 17')).not.toContainText('Request pending')
    await expect(day2('Sat, Dec 19')).toContainText('4:00 PM – 10:00 PM') // swapped in
    await expect(day2('Sat, Dec 19')).toContainText('Changed')
    await expectAccessible(page)
  })

  // The mock's only Staff persona (PT-02) works three days a week, so no swap of theirs can
  // leave anyone without a 24-hour rest after 6 days; the block is covered by the
  // staff-requests-panel RTL test with a stubbed check.
  test.fixme('approving a swap that breaks the 24-hour rest after 6 days is blocked', async () => {})
})
