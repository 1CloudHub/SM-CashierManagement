import { expect, test, type Page } from '@playwright/test'
import { expectAccessible, go, heading, open, switchRole } from '../support/app'

/**
 * J10 — Cover an open shift from nearby stores (design.md "User journeys").
 * SCR-022 open shifts → "Find cover nearby" → SCR-026 network map → store
 * selected → candidates ranked by travel time, pseudonymous, barangay only
 * (P15, consent) → offer to selected cashiers (P16 eligibility shown) →
 * Staff accepts on SCR-025 → first acceptance wins (P17) → roster updated ✎;
 * store-to-store borrow request → lending store manager approves; Auto-match
 * all gaps → send all offers. Each test runs in one page session (the mock
 * API lives in the page), handing work between roles with the demo switcher.
 */

const ROSTER = /roster, mon, dec 14 to sun, dec 20/i
/** Anything finer than a barangay: coordinates, street addresses (P15). */
const FINE_LOCATION = /-?\d{1,3}\.\d{3,}|street|address/i

async function openRoster(page: Page) {
  await open(page, '/plan/roster', 'STM')
  await expect(page.getByRole('table', { name: ROSTER })).toBeVisible()
  const banner = page.getByRole('region', { name: 'Open shifts' })
  await expect(banner).toBeVisible()
  return banner
}

async function selectStore(page: Page, name: string) {
  const stores = page.getByRole('table', { name: 'Stores by staffing gap' })
  await expect(stores).toBeVisible()
  await page.getByRole('button', { name: `Find cover at ${name}` }).click()
  const ranked = page.getByRole('table', { name: 'Candidates ranked by travel time' })
  await expect(ranked).toBeVisible()
  return { stores, ranked, panel: page.getByRole('complementary', { name: 'Selected store' }) }
}

test.describe('J10 cover an open shift (SCR-022 → SCR-026 → SCR-025)', () => {
  test('Store Manager: open shift → Find cover nearby → map scoped to own store, ranked pseudonymous candidates → offer to selected', async ({ page }) => {
    const banner = await openRoster(page)
    await expect(banner).toContainText('1 open shifts')
    await expect(banner).toContainText('Sat, Dec 19, 4:00 PM – 10:00 PM')
    await expectAccessible(page)

    // "Find cover nearby" is a client-side link to SCR-026 (keeps the in-page mock state).
    await banner.getByRole('link', { name: 'Find cover nearby (network map)' }).click()
    await expect(page).toHaveURL(/\/plan\/map$/)
    await expect(heading(page)).toHaveText('Network map — Metro Manila')

    // P1: a Store Manager's map shows their own store only.
    const { stores, ranked, panel } = await selectStore(page, 'SM Megamall')
    await expect(stores.getByRole('row')).toHaveCount(2)
    await expect(page.getByRole('button', { name: /^SM Megamall: Short 4/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(panel).toContainText('Short 4')

    // Ranked by travel time; pseudonymous ID + home store + barangay only (P15).
    const rows = ranked.getByRole('row')
    await expect(rows.nth(1)).toContainText('XS-14 · SM Center Pasig')
    await expect(rows.nth(1)).toContainText('Brgy. Wack-Wack Greenhills, Mandaluyong')
    const minutes = await ranked.locator('tbody tr td:nth-child(3)').allInnerTexts()
    const travel = minutes.map((m) => Number(/(\d+) min/.exec(m)?.[1]))
    expect(travel.length).toBeGreaterThan(1)
    expect(travel).toEqual([...travel].sort((a, b) => a - b))
    // P15: non-consented cashiers are left out (counted, never listed); no location finer than barangay.
    await expect(panel).toContainText('3 cashiers aren’t shown because they don’t share a home area.')
    expect(await page.getByRole('main').innerText()).not.toMatch(FINE_LOCATION)
    // P16: cashiers who can't take the shift are shown separately, with the reason.
    const nearMiss = page.getByRole('table', { name: 'Cashiers within reach who can’t take this shift' })
    await expect(nearMiss).toContainText('Not trained on this department')
    // Only the manager's own store: no cross-store borrowing from the Store Manager's map.
    await expect(panel).toContainText('No nearby store has spare cashiers.')
    await expectAccessible(page)

    // Offer to the selected cashiers.
    await ranked.getByRole('checkbox', { name: 'Select XS-14' }).check()
    await ranked.getByRole('checkbox', { name: 'Select PT-41' }).check()
    await panel.getByRole('button', { name: 'Offer shift to 2 selected' }).click()
    await expect(panel.getByText('Offers sent to 2 cashiers.')).toBeVisible()
    const status = page.getByRole('list', { name: 'Offers for this shift' })
    await expect(status).toContainText(/XS-14 · waiting, 30 min left/)
    await expect(status).toContainText(/PT-41 · waiting, 30 min left/)
    await expect(ranked.getByRole('checkbox', { name: 'Select XS-14' })).toBeDisabled()
    await expectAccessible(page)
  })

  test('offer to eligible staff (P16) → Staff accepts on SCR-025 → first acceptance wins (P17) → roster updated ✎', async ({ page }) => {
    const banner = await openRoster(page)
    await banner.getByRole('button', { name: /^Offer Sat, Dec 19, 4:00 PM – 10:00 PM to eligible staff$/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Offer to eligible staff' })
    await expect(dialog).toContainText('Only cashiers who are trained, available and within every labor rule (hours at all stores counted) are listed.')
    const eligible = dialog.getByRole('table', { name: 'Eligible cashiers for this shift' })
    await expect(eligible).toBeVisible()
    // P16: travel, transport allowance and hours across all stores per candidate.
    await expect(eligible.getByRole('columnheader', { name: 'Hours (all stores)' })).toBeVisible()
    await expect(eligible.getByRole('row', { name: /PT-02/ })).toContainText(/of 30 h this week/)
    // P15: other stores' cashiers are pseudonymous before acceptance; barangay only.
    await expect(eligible).toContainText('XS-14 · SM Hypermarket – Mall of Asia')
    await expect(dialog.getByText(/Jo Santos|Rosa Lim/)).toHaveCount(0)
    expect(await dialog.innerText()).not.toMatch(FINE_LOCATION)
    await expect(dialog).toContainText('cashiers aren’t listed because they don’t share a home area.')
    await expectAccessible(page, '[role="dialog"]')

    await eligible.getByRole('checkbox', { name: 'Offer to PT-02' }).check()
    await eligible.getByRole('checkbox', { name: 'Offer to XS-14' }).check()
    await dialog.getByRole('button', { name: 'Send offers to 2' }).click()
    await expect(dialog).toBeHidden()
    const status = banner.getByRole('list', { name: /^Offers for/ })
    await expect(status).toContainText(/PT-02 Juan dela Cruz · waiting, 30 min left/)
    await expect(status).toContainText(/XS-14 · waiting/)

    // The cashier (Staff, PT-02) accepts on their phone screen.
    await switchRole(page, 'STF')
    await go(page, '/my-roster')
    await expect(heading(page)).toHaveText('My roster')
    const offers = page.getByRole('region', { name: 'Open shift offers near you' })
    await expect(offers).toContainText('SM Supermarket – Quezon City')
    await expect(offers).toContainText(/expires in 30 min/)
    await expectAccessible(page)
    await offers.getByRole('button', { name: 'Accept the shift at SM Supermarket – Quezon City on Sat, Dec 19' }).click()
    await expect(offers.getByText('You got the shift. It’s now on your roster.')).toBeVisible()
    await expect(offers.getByRole('heading', { name: 'Earlier offers' })).toBeVisible()
    // Nothing left to accept: a second acceptance for the same shift is impossible (P17).
    await expect(offers.getByRole('button', { name: /^Accept the shift/ })).toHaveCount(0)
    await expectAccessible(page)

    // Back on SCR-022: the open shift is filled once, recorded as a change (✎) — the other offer was withdrawn with it.
    await switchRole(page, 'STM')
    await go(page, '/plan/roster')
    await expect(page.getByRole('table', { name: ROSTER })).toBeVisible()
    const changes = page.getByRole('region', { name: 'Changes to the published roster' })
    await expect(changes.getByText(/Filled by an accepted offer · Demo STM/)).toHaveCount(1)
    await expect(page.getByRole('region', { name: 'Open shifts' })).toHaveCount(0)
    await expectAccessible(page)
  })

  test('store to store: a Planner requests cashiers from a nearby store; the lending store manager approves', async ({ page }) => {
    // Planner on the map: the selected short store lists nearby stores with spare cashiers.
    await open(page, '/plan/map', 'PLN')
    const { panel } = await selectStore(page, 'SM Megamall')
    const borrow = panel.getByRole('region', { name: 'Borrow from a nearby store' })
    await expect(borrow.getByRole('listitem').first()).toContainText(/spare · \d+ min/)
    await borrow.getByRole('button', { name: 'Request 1' }).first().click()
    await expect(panel.getByText(/Borrow request sent to .*Its store manager decides\./)).toBeVisible()
    await expectAccessible(page)

    // The lending store manager (Quezon City) reviews the request asking their store to lend.
    await switchRole(page, 'STM')
    await go(page, '/plan/roster')
    await expect(page.getByRole('table', { name: ROSTER })).toBeVisible()
    const requests = page.getByRole('region', { name: 'Borrow requests' })
    await expect(requests).toContainText('Asking this store to lend')
    await expect(requests).toContainText('Waiting for approval')
    await requests.getByRole('button', { name: 'Review the request from SM Hypermarket – Mall of Asia' }).click()
    const dialog = page.getByRole('dialog', { name: /^Lend cashiers to SM Hypermarket – Mall of Asia/ })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('checkbox', { name: /FT-03 Ana Reyes/ }).check()
    await expectAccessible(page, '[role="dialog"]')
    await dialog.getByRole('button', { name: 'Approve 1' }).click()
    await expect(dialog).toBeHidden()
    await expect(requests).toContainText('Approved')
    await expect(requests).toContainText('Going: FT-03 Ana Reyes')
    await expectAccessible(page)
  })

  test('Auto-match all gaps → review the network suggestion → send all offers', async ({ page }) => {
    await open(page, '/plan/map', 'PLN')
    await expect(page.getByRole('table', { name: 'Stores by staffing gap' })).toBeVisible()
    await page.getByRole('button', { name: 'Auto-match all gaps' }).click()
    const dialog = page.getByRole('dialog', { name: 'Review suggested cover' })
    await expect(dialog.getByRole('table', { name: 'Suggested offers' })).toBeVisible()
    await expect(dialog).toContainText(/Suggested: \d+ offers and \d+ moves across \d+ stores cover \d+ of \d+ open shifts/)
    await expect(dialog).toContainText('cashiers who don’t share a home area were left out.')
    expect(await dialog.innerText()).not.toMatch(FINE_LOCATION)
    await expectAccessible(page, '[role="dialog"]')

    const send = dialog.getByRole('button', { name: /^Send \d+ offers and \d+ borrow requests$/ })
    const [, offers, moves] = /Send (\d+) offers and (\d+) borrow/.exec((await send.textContent()) ?? '') ?? []
    expect(Number(offers)).toBeGreaterThan(0)
    await send.click()
    await expect(dialog.getByText(`Sent ${offers} offers and ${moves} borrow requests.`)).toBeVisible()
    await expectAccessible(page, '[role="dialog"]')
  })
})
