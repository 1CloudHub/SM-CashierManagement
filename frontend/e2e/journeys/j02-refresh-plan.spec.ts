import { expect, test, type Page } from '@playwright/test'
import { expectAccessible, expectNoAccess, go, heading, open, switchRole } from '../support/app'

/**
 * J2 — Planner refreshes a plan after new data (design.md › User journeys).
 *
 * Notification / home alert "POS data refreshed, 2 scenarios stale" → SCR-030
 * stale filter → duplicate the published scenario → SCR-031 settings → run →
 * SCR-023 hiring plan (background job with progress) → SCR-032 compare vs
 * published → submit for approval. Also P4 (published settings read-only),
 * P5 (stale shown, stale cannot be submitted) and P8 (a filtered URL
 * reproduces its filters on reload).
 */

const rowOf = (page: Page, name: string) =>
  page.getByRole('row').filter({ has: page.getByRole('link', { name, exact: true }) })

test.describe('J2 Planner refreshes a plan after new data', () => {
  test('home alert and notifications lead to the stale filter; the filtered URL survives a reload (P5, P8)', async ({ page }) => {
    await open(page, '/', 'PLN')
    await expect(page.getByText('2 scenarios are stale after the POS refresh')).toBeVisible()
    await expectAccessible(page)

    // The notification centre has the POS load and the stale-scenario notice.
    await go(page, '/notifications')
    await expect(page.getByRole('main').getByText('Data load succeeded — pos_hourly_2026-09.csv')).toBeVisible()
    await expect(page.getByRole('main').getByText('Scenario stale: recalculate — Christmas 2026 v4')).toBeVisible()
    await expectAccessible(page)

    // SCR-030: stale filter.
    await go(page, '/scenarios')
    await expect(rowOf(page, 'Christmas 2026 v3')).toBeVisible()
    await page.getByRole('checkbox', { name: 'Stale only' }).click()
    await expect(page).toHaveURL(/\/scenarios\?stale=true$/)
    await expect(page.getByRole('checkbox', { name: 'Stale only' })).toBeChecked()
    await expect(rowOf(page, 'Christmas 2026 v3')).toHaveCount(0)
    const v4 = rowOf(page, 'Christmas 2026 v4')
    await expect(v4.getByText('Stale', { exact: true })).toBeVisible()
    // P5: the stale draft cannot be submitted, with the reason.
    const submit = v4.getByRole('button', { name: 'Submit: Christmas 2026 v4' })
    await expect(submit).toBeDisabled()
    await expect(submit).toHaveAccessibleDescription('Recalculate first: this scenario is stale.')
    await expectAccessible(page)

    // P8: reloading the filtered URL reproduces the same filter and rows.
    await page.reload()
    await expect(heading(page)).toHaveText('Scenarios')
    await expect(page.getByRole('checkbox', { name: 'Stale only' })).toBeChecked()
    await expect(rowOf(page, 'Christmas 2026 v4')).toBeVisible()
    await expect(rowOf(page, 'Christmas 2026 v3')).toHaveCount(0)

    // P8 with more filters: search + status + season round-trip through a fresh load.
    await page.goto('/scenarios?q=Christmas&status=draft&season=christmas-2026')
    await expect(page.getByRole('searchbox', { name: 'Search scenarios' })).toHaveValue('Christmas')
    await expect(page.getByRole('combobox', { name: 'Status' })).toHaveValue('draft')
    await expect(page.getByRole('combobox', { name: 'Season' })).toHaveValue('christmas-2026')
    await expect(rowOf(page, 'Christmas 2026 v4')).toBeVisible()
    await expect(rowOf(page, 'Christmas 2026 v3')).toHaveCount(0)
    await expect(rowOf(page, 'Ber months 2026 v1')).toHaveCount(0)
  })

  test('duplicate the published scenario, run, review the hiring plan, compare vs published and submit (P4, P5)', async ({ page }) => {
    // P4: the published scenario's settings are read-only, with Duplicate as draft.
    await open(page, '/scenarios', 'PLN')
    await page.getByRole('link', { name: 'Christmas 2026 v3', exact: true }).click()
    await expect(heading(page)).toHaveText('Christmas 2026 v3')
    await expect(page.getByText('This scenario is read-only')).toBeVisible()
    await expect(page.getByLabel('Volume growth (%)')).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Submit for approval' })).toHaveCount(0)
    await expectAccessible(page)

    await page.getByRole('button', { name: 'Duplicate as draft' }).click()
    await expect(page).toHaveURL(/\/scenarios\/scn-new-\d+\/settings$/)
    await expect(heading(page)).toHaveText('Christmas 2026 v3 (copy)')
    const id = /\/scenarios\/([^/]+)\/settings/.exec(page.url())![1]!

    // SCR-031: a fresh draft must be run before it can be submitted.
    const submit = page.getByRole('button', { name: 'Submit for approval' })
    await expect(submit).toBeDisabled()
    await expect(page.getByText('Run the scenario before submitting it.')).toBeVisible()
    const growth = page.getByLabel('Volume growth (%)')
    await expect(growth).toBeEnabled()
    await growth.fill('7')
    await expect(page.getByText('Save and run first: you have unsaved changes.')).toBeVisible()
    await expectAccessible(page)
    await page.getByRole('button', { name: 'Save and run' }).click()
    await expect(page.getByRole('note').getByText('Run complete')).toBeVisible()
    await expect(submit).toBeEnabled()

    // SCR-023: the hiring plan runs as a background job with progress.
    await go(page, `/plan/hiring?scenario=${id}`)
    await expect(page.getByText('No hiring plan for this scenario yet')).toBeVisible()
    await page.getByRole('button', { name: 'Run hiring plan' }).click()
    await expect(page.getByRole('progressbar', { name: 'Calculation progress' })).toBeVisible()
    await expect(page.getByText('Seasonal hires needed')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('heading', { name: 'When to act' })).toBeVisible()
    await expectAccessible(page)

    // SCR-032: compare with the published scenario (B defaults to it).
    await go(page, `/scenarios/compare?a=${id}`)
    await expect(page).toHaveURL(new RegExp(`a=${id}&b=scn-xmas-2026-v3`))
    const headline = page.getByRole('table', { name: 'Headline differences' })
    await expect(headline.getByRole('rowheader', { name: 'Seasonal hires' })).toBeVisible()
    const settings = page.getByRole('table', { name: 'Settings that differ' })
    const growthRow = settings.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Volume growth (%)' }) })
    await expect(growthRow.getByText('+7 %')).toBeVisible()
    await expect(growthRow.getByText('+5 %')).toBeVisible()
    await expectAccessible(page)

    // Submit for approval from SCR-031; the scenario becomes read-only (P4).
    await go(page, `/scenarios/${id}/settings`)
    await expect(heading(page)).toHaveText('Christmas 2026 v3 (copy)')
    await submit.click()
    await expect(page.getByRole('note').getByText('Submitted for approval')).toBeVisible()
    await expect(page.getByText('This scenario is read-only')).toBeVisible()
    await expect(page.getByLabel('Volume growth (%)')).toBeDisabled()
    await expectAccessible(page)

    await go(page, '/scenarios')
    await expect(rowOf(page, 'Christmas 2026 v3 (copy)').getByText('Submitted', { exact: true })).toBeVisible()
    // The published plan is unchanged until the Executive approves (P3).
    await expect(rowOf(page, 'Christmas 2026 v3').getByRole('img', { name: 'Published scenario' })).toBeVisible()

    // HR now finds it awaiting headcount approval.
    await switchRole(page, 'HR')
    await go(page, '/approvals')
    await expect(rowOf(page, 'Christmas 2026 v3 (copy)').getByText('Awaiting you')).toBeVisible()
  })

  test('scenario visibility by role: viewers are read-only, Store Manager sees published only, Staff has no access', async ({ page }) => {
    await open(page, '/scenarios/scn-xmas-2026-v3/settings', 'FIN')
    await expect(page.getByText('Read-only for your role.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Duplicate as draft' })).toHaveCount(0)

    await go(page, '/scenarios')
    await expect(page.getByRole('button', { name: 'New scenario' })).toHaveCount(0)
    await expect(rowOf(page, 'Christmas 2026 v4').getByRole('button', { name: /^Submit/ })).toHaveCount(0)

    await switchRole(page, 'STM')
    await go(page, '/scenarios')
    await expect(rowOf(page, 'Christmas 2026 v3')).toBeVisible()
    await expect(rowOf(page, 'Christmas 2026 v4')).toHaveCount(0)
    await expectAccessible(page)

    await switchRole(page, 'STF')
    await go(page, '/scenarios')
    await expectNoAccess(page)
  })
})
