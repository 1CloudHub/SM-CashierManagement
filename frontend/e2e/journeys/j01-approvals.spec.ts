import { expect, test, type Page } from '@playwright/test'
import { expectAccessible, expectNoAccess, go, heading, open, switchRole } from '../support/app'

/**
 * J1 — Headcount, budget and plan approval (design.md › User journeys, SCR-030/031/033).
 *
 * HR and Finance secure headcount and budget (in either order); the Executive
 * approves the plan last (P10). The Executive may record a step as secured
 * outside the system, and HR and Finance then see that record. One page per
 * test: the mock API lives in the page, so roles hand work to each other with
 * switchRole() + client-side navigation.
 */

const tracker = (page: Page) => page.getByRole('region', { name: 'Approval tracker' })
const decision = (page: Page) => page.getByRole('region', { name: 'Your decision' })

/** Opens a scenario's review from the approvals queue (in-app click). */
async function openReview(page: Page, name: string) {
  await go(page, '/approvals')
  await page.getByRole('link', { name }).click()
  await expect(heading(page)).toHaveText(`Review: ${name}`)
}

test.describe('J1 Headcount, budget and plan approval', () => {
  test('Planner submits → HR approves headcount → Finance approves budget → Executive approves and publishes', async ({ page }) => {
    // ── Planner: SCR-031, recalculate the stale draft and submit it ─────────
    await open(page, '/scenarios/scn-xmas-2026-v4/settings', 'PLN')
    await expect(heading(page)).toHaveText('Christmas 2026 v4')
    const submit = page.getByRole('button', { name: 'Submit for approval' })
    // P5: a stale scenario cannot be submitted.
    await expect(submit).toBeDisabled()
    await expect(page.getByText('Recalculate first: this scenario is stale.')).toBeVisible()
    await page.getByRole('button', { name: 'Recalculate' }).click()
    await expect(page.getByRole('note').getByText('Run complete')).toBeVisible()
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(page.getByRole('note').getByText('Submitted for approval')).toBeVisible()
    // P4: once submitted, the settings are read-only.
    await expect(page.getByText('This scenario is read-only')).toBeVisible()
    await expect(page.getByLabel('Volume growth (%)')).toBeDisabled()
    await expectAccessible(page)

    // The Planner cannot open approvals (RBAC matrix: Approve * = — for PLN).
    await go(page, '/approvals')
    await expectNoAccess(page)

    // ── HR: SCR-033, approve headcount ──────────────────────────────────────
    await switchRole(page, 'HR')
    await go(page, '/approvals')
    await expect(heading(page)).toHaveText('Approvals')
    const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Christmas 2026 v4' }) })
    await expect(row.getByText('Awaiting you')).toBeVisible()
    await expectAccessible(page)
    await row.getByRole('link', { name: 'Christmas 2026 v4' }).click()
    await expect(heading(page)).toHaveText('Review: Christmas 2026 v4')
    await expect(page.getByRole('region', { name: 'Headcount (your step)' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Budget (your step)' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Approve budget' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Approve and publish plan' })).toHaveCount(0)
    await expectAccessible(page)
    await page.getByRole('button', { name: 'Approve headcount' }).click()
    await expect(page.getByText('Decision recorded.')).toBeVisible()
    await expect(tracker(page).getByText(/^L\. Tan \(HR\), /)).toBeVisible()

    // ── Finance: approve budget (only its own step) ─────────────────────────
    await switchRole(page, 'FIN')
    await openReview(page, 'Christmas 2026 v4')
    await expect(page.getByRole('region', { name: 'Budget (your step)' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Headcount (your step)' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Approve headcount' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Approve and publish plan' })).toHaveCount(0)
    await expectAccessible(page)
    await page.getByRole('button', { name: 'Approve budget' }).click()
    await expect(page.getByText('Decision recorded.')).toBeVisible()
    await expect(tracker(page).getByText(/^R\. Santos \(Finance\), /)).toBeVisible()
    await expect(tracker(page).getByText('Ready for the Executive’s decision.')).toBeVisible()

    // ── Executive: approve and publish (P10 satisfied in the system) ────────
    await switchRole(page, 'EXE')
    await openReview(page, 'Christmas 2026 v4')
    const publish = page.getByRole('button', { name: 'Approve and publish plan' })
    await expect(publish).toBeEnabled()
    await expectAccessible(page)
    await publish.click()
    const confirm = page.getByRole('dialog', { name: 'Approve and publish?' })
    await expect(confirm.getByText('“Christmas 2026 v4” replaces “Christmas 2026 v3” as the published plan.', { exact: false })).toBeVisible()
    await expectAccessible(page, '[role="dialog"]')
    await confirm.getByRole('button', { name: 'Approve and publish' }).click()
    await expect(page.getByText('Published. Everyone in scope has been notified.')).toBeVisible()
    await expect(confirm).toBeHidden()
    await expect(decision(page)).toHaveCount(0)

    // P3: v4 is now the single published plan; v3 is superseded.
    await go(page, '/scenarios')
    const v4 = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Christmas 2026 v4', exact: true }) })
    const v3 = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Christmas 2026 v3', exact: true }) })
    await expect(v4.getByRole('img', { name: 'Published scenario' })).toBeVisible()
    await expect(v3.getByText('Superseded')).toBeVisible()
    await expect(page.getByRole('img', { name: 'Published scenario' })).toHaveCount(1)
    await expectAccessible(page)
  })

  test('Finance must comment to request changes; the scenario returns to the Planner as a draft', async ({ page }) => {
    // Ber months 2026 v1 is seeded as submitted with HR headcount already approved.
    await open(page, '/approvals?scenario=scn-ber-2026-v1', 'FIN')
    await expect(heading(page)).toHaveText('Review: Ber months 2026 v1')
    await expect(tracker(page).getByText('L. Tan (HR), Sep 30, 2026, 10:00 AM')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Budget (your step)' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Headcount (your step)' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Record headcount/budget secured outside the system' })).toHaveCount(0)

    const requestChanges = page.getByRole('button', { name: 'Request changes: Budget' })
    await requestChanges.click()
    await expect(page.getByText('Add a comment to request changes or reject.')).toBeVisible()
    await expectAccessible(page)
    await page.getByLabel(/^Comment/).fill('Trim PT hours in Cebu')
    await requestChanges.click()
    await expect(page.getByText('Returned to the planner as a draft.')).toBeVisible()
    await expect(tracker(page).getByText('“Trim PT hours in Cebu”')).toBeVisible()
    await expect(decision(page)).toHaveCount(0)

    // Back to Draft: the Planner sees it as an editable draft again.
    await switchRole(page, 'PLN')
    await go(page, '/scenarios')
    const ber = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Ber months 2026 v1' }) })
    await expect(ber.getByText('Draft', { exact: true })).toBeVisible()
    await expect(ber.getByRole('button', { name: 'Submit: Ber months 2026 v1' })).toBeEnabled()
    await expectAccessible(page)
  })

  test('Executive records budget secured outside the system, then approves and publishes (P10); HR sees the record', async ({ page }) => {
    await open(page, '/approvals', 'EXE')
    await page.getByRole('link', { name: 'Ber months 2026 v1' }).click()
    await expect(heading(page)).toHaveText('Review: Ber months 2026 v1')

    // P10: the plan cannot be decided while budget is still pending.
    const publish = page.getByRole('button', { name: 'Approve and publish plan' })
    await expect(publish).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Reject: Plan' })).toBeDisabled()
    await expect(page.getByText('Plan buttons stay disabled until headcount and budget are both secured.')).toBeVisible()
    await expectAccessible(page)

    await page.getByRole('button', { name: 'Record headcount/budget secured outside the system' }).click()
    const dialog = page.getByRole('dialog', { name: 'Record as secured outside the system' })
    await expect(dialog.getByLabel('Step')).toHaveValue('budget')
    await dialog.getByRole('button', { name: 'Record' }).click()
    await expect(dialog.getByText('Enter a reference and a note.')).toHaveCount(2)
    await dialog.getByLabel(/^Reference/).fill('email 2 Oct')
    await dialog.getByLabel(/^Note/).fill('Agreed with the CFO')
    await expectAccessible(page, '[role="dialog"]')
    await dialog.getByRole('button', { name: 'Record' }).click()
    await expect(page.getByText('Recorded as secured outside the system.')).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(tracker(page).getByText(/Recorded outside the system by M\. Cruz \(Executive\).*ref “email 2 Oct”/)).toBeVisible()
    await expect(tracker(page).getByText('Ready for the Executive’s decision.')).toBeVisible()

    // HR and Finance see the off-system record (read-only for them now).
    await switchRole(page, 'HR')
    await openReview(page, 'Ber months 2026 v1')
    await expect(tracker(page).getByText(/Recorded outside the system by M\. Cruz \(Executive\).*ref “email 2 Oct”/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approve and publish plan' })).toHaveCount(0)
    await expectAccessible(page)

    // Back to the Executive: both secured → approve and publish.
    await switchRole(page, 'EXE')
    await openReview(page, 'Ber months 2026 v1')
    await expect(publish).toBeEnabled()
    await publish.click()
    const confirm = page.getByRole('dialog', { name: 'Approve and publish?' })
    await confirm.getByRole('button', { name: 'Approve and publish' }).click()
    await expect(page.getByText('Published. Everyone in scope has been notified.')).toBeVisible()
    await expect(decision(page)).toHaveCount(0)
    await expectAccessible(page)
  })

  test('role visibility: Planner, Staff, Store Manager and Admin have no access to SCR-033', async ({ page }) => {
    await open(page, '/approvals', 'PLN')
    await expectNoAccess(page)
    await expectAccessible(page)
    for (const role of ['STF', 'STM', 'RST'] as const) {
      await switchRole(page, role)
      await go(page, '/approvals?scenario=scn-ber-2026-v1')
      await expectNoAccess(page)
      await expect(page.getByRole('region', { name: 'Approval tracker' })).toHaveCount(0)
    }
    // Executive, HR and Finance can open the queue.
    for (const role of ['EXE', 'HR', 'FIN'] as const) {
      await switchRole(page, role)
      await go(page, '/approvals')
      await expect(heading(page)).toHaveText('Approvals')
      await expect(page.getByRole('link', { name: 'Ber months 2026 v1' })).toBeVisible()
    }
  })
})
