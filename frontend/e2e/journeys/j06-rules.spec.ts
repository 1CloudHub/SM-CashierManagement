import { expect, test, type Page } from '@playwright/test'
import { expectAccessible, expectNoAccess, go, heading, open, switchRole } from '../support/app'

/**
 * J6 — Rules steward publishes a new wage order (design.md › User journeys).
 *
 * SCR-060 → new draft version with an effective date → SCR-061 edit the wage
 * rate → impact panel → (cost rule) submit to Finance → Finance approves and
 * publishes → affected scenarios are flagged stale (P5, P6).
 *
 * GAP: the in-page mock API (src/api/mock.ts) has no `/rule-sets` or
 * `/rule-versions` endpoints, so in mock/demo mode SCR-060 shows "We couldn’t
 * load the rule sets." for every role that may view rules, and SCR-061 can't
 * load a version. The journey itself is written below as `test.fixme` (labels
 * taken from src/features/rules/screens.test.tsx) so it can be switched on
 * once a rules mock exists; the role visibility that does not depend on data
 * is asserted now.
 */

const ruleRow = (page: Page, name: string) => page.getByRole('row').filter({ has: page.getByRole('rowheader', { name }) })

test.describe('J6 Rules steward publishes a new wage order', () => {
  test('role visibility on SCR-060: rules viewers reach the screen; Staff, Store Manager and Admin have no access', async ({ page }) => {
    await open(page, '/rules', 'RST')
    await expect(heading(page)).toHaveText('Business rule sets')
    await expectAccessible(page)

    // RBAC matrix "Business rules": V for EXE, PLN, HR, FIN; M for RST.
    for (const role of ['EXE', 'PLN', 'HR', 'FIN'] as const) {
      await switchRole(page, role)
      await go(page, '/rules')
      await expect(heading(page)).toHaveText('Business rule sets')
      await expect(page.getByText('Your role doesn’t include business rules.')).toHaveCount(0)
    }
    // "—" for STM, STF and ADM: SCR-060 is out of scope (P12).
    for (const role of ['STM', 'STF', 'ADM'] as const) {
      await switchRole(page, role)
      await go(page, '/rules')
      await expectNoAccess(page)
    }
    // SCR-061 (the editor) is out of scope for Store Manager and Staff too.
    // NOTE: the route table (src/app/screens.ts, pinned to the wireframe's
    // data-page-roles "rst fin adm") lets ADM open SCR-061 although the RBAC
    // matrix gives ADM no rules access, and gives EXE/PLN/HR — who may view
    // rule versions and get a "View" button on SCR-060 — "No access" there.
    // Reported as a spec/route inconsistency; not asserted here.
    for (const role of ['STM', 'STF'] as const) {
      await switchRole(page, role)
      await go(page, '/rules/rules-wages/edit')
      await expectNoAccess(page)
    }
    await expectAccessible(page)
  })

  test.fixme('Rules Steward drafts a wage order, Finance approves and publishes, affected scenarios turn stale', async ({ page }) => {
    // Needs a mock for /rule-sets and /rule-versions (see the GAP note above).
    await open(page, '/rules', 'RST')
    const wages = ruleRow(page, 'Wage rates')
    await expect(wages.getByText('Yes')).toBeVisible() // cost rule
    await expectAccessible(page)

    // SCR-060 → new draft with an effective date.
    await wages.getByRole('button', { name: 'New draft: Wage rates' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/Effective from/).fill('2026-11-01')
    await expectAccessible(page, '[role="dialog"]')
    await dialog.getByRole('button', { name: 'Create draft' }).click()
    await expect(page).toHaveURL(/\/rules\/[^/]+\/edit\?version=/)
    await expect(heading(page)).toContainText('Wage rates · Version')

    // SCR-061: edit the NCR wage rate, see the impact panel, save.
    await expect(page.getByText('Cost rule')).toBeVisible()
    await expect(page.getByText(/scenarios use an earlier version/)).toBeVisible()
    await page.getByRole('textbox', { name: 'Base rate by region (₱/h) › NCR' }).fill('90')
    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(page.getByText('Draft saved.')).toBeVisible()
    // A cost rule cannot be published by the Rules Steward.
    await expect(page.getByRole('button', { name: 'Publish' })).toHaveCount(0)
    await expectAccessible(page)

    // Submit to Finance.
    await page.getByRole('button', { name: 'Submit to Finance' }).click()
    const submit = page.getByRole('dialog', { name: /^Submit Wage rates version \d+ to Finance\?$/ })
    await submit.getByRole('button', { name: 'Submit' }).click()
    await expect(page.getByText('Submitted to Finance. Finance has been notified.')).toBeVisible()
    const editorUrl = new URL(page.url()).pathname + new URL(page.url()).search

    // Finance: the queue tells it a cost rule waits; request changes needs a comment.
    await switchRole(page, 'FIN')
    await go(page, '/rules')
    await expect(page.getByText('1 cost rule is waiting for your approval before it can be published.')).toBeVisible()
    await page.getByRole('button', { name: /^Review Wage rates version \d+$/ }).click()
    await expect(page).toHaveURL(new RegExp(editorUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    await expect(page.getByRole('button', { name: 'Save draft' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Approve and publish' }).click()
    const confirm = page.getByRole('dialog')
    await expect(confirm.getByText(/scenarios will be marked stale/)).toBeVisible()
    await expectAccessible(page, '[role="dialog"]')
    await confirm.getByRole('button', { name: 'Approve and publish' }).click()
    await expect(page.getByText(/^Published\. \d+ scenarios? (was|were) marked stale\.$/)).toBeVisible()

    // Affected scenarios are flagged stale for the Planner (P5) and can't be submitted.
    await switchRole(page, 'PLN')
    await go(page, '/scenarios?stale=true')
    const ber = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Ber months 2026 v1' }) })
    await expect(ber.getByText('Stale', { exact: true })).toBeVisible()
  })

  test.fixme('Finance requests changes on a submitted cost rule (comment required); the Steward sees the comment', async ({ page }) => {
    // Needs a mock for /rule-sets and /rule-versions (see the GAP note above).
    await open(page, '/rules', 'RST')
    await ruleRow(page, 'Wage rates').getByRole('button', { name: 'New draft: Wage rates' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Create draft' }).click()
    await page.getByRole('button', { name: 'Submit to Finance' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Submit' }).click()
    await expect(page.getByText('Submitted to Finance. Finance has been notified.')).toBeVisible()

    await switchRole(page, 'FIN')
    await page.getByRole('button', { name: 'Request changes' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Request changes' }).click()
    await expect(dialog.getByText('Add a comment so the Rules Steward knows what to change.')).toBeVisible()
    await dialog.getByLabel(/What needs to change/).fill('Cite the wage order number')
    await dialog.getByRole('button', { name: 'Request changes' }).click()

    await switchRole(page, 'RST')
    await expect(page.getByText('Finance requested changes')).toBeVisible()
    await expect(page.getByText('Cite the wage order number')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save draft' })).toBeVisible()
  })
})
