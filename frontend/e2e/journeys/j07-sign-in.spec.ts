import { expect, test, type Page } from '@playwright/test'
import { expectAccessible, heading } from '../support/app'

/**
 * J7 — First sign-in with a passkey (design.md › User journeys; SCR-001/002).
 *
 * The e2e dev server runs without Cognito ids, so it normally shows the
 * signed-in demo app. To reach the real sign-in screens we answer
 * `/runtime-config.json` with a syntactically valid but fake configuration
 * (see src/features/auth/runtime-config.ts) so `main.tsx` mounts `Root` with
 * the Amplify auth client — and we abort EVERY request to *.amazonaws.com,
 * so nothing ever reaches AWS and no real credentials are used.
 *
 * Automated here: SCR-001 renders and passes axe; an invalid email and a
 * non-allowed domain are rejected client-side with no call to Cognito (P13);
 * "Use an email code" / "Set one up" opens SCR-002; an allowed-domain passkey
 * attempt with Cognito unreachable shows a failure state instead of crashing.
 *
 * Known gap: the passkey ceremony itself (email OTP → WebAuthn create → get
 * started → Home) needs a real Cognito user pool and is not automated.
 */

const FAKE_CONFIG = {
  userPoolId: 'us-east-1_AbCdEf123',
  userPoolClientId: 'e2efakeclientid0123456789',
  selfSignUp: true,
}

/** Mounts the real auth gate (fake Cognito ids) and records every AWS attempt (all aborted). */
async function withFakeCognito(page: Page): Promise<string[]> {
  const awsCalls: string[] = []
  await page.route(/amazonaws\.com/, (route) => {
    awsCalls.push(route.request().url())
    return route.abort()
  })
  await page.route('**/runtime-config.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_CONFIG) }),
  )
  await page.addInitScript(() => {
    try {
      localStorage.setItem('lw.locale', 'en')
    } catch {
      // storage blocked: English is the default anyway
    }
  })
  return awsCalls
}

async function openSignIn(page: Page) {
  // Any app URL redirects to /sign-in while signed out.
  await page.goto('/plan/network')
  await expect(page).toHaveURL(/\/sign-in$/)
  await expect(heading(page)).toHaveText('Sign in to LaneWise')
}

const email = (page: Page) => page.getByRole('textbox', { name: /Work email/ })
const submit = (page: Page) => page.getByRole('button', { name: 'Sign in with a passkey' })

test.describe('J7 — First sign-in with a passkey', () => {
  test('SCR-001 renders accessibly; invalid email and outside domain are refused without calling Cognito (P13)', async ({ page }) => {
    const awsCalls = await withFakeCognito(page)
    await openSignIn(page)
    await expect(page).toHaveTitle('Sign in — LaneWise')
    await expect(email(page)).toBeVisible()
    await expect(submit(page)).toBeEnabled()
    // Passkey only: there is no password field.
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
    await expectAccessible(page)

    // Invalid email.
    await email(page).fill('juan')
    await submit(page).click()
    await expect(page.getByText('Enter your work email, like juan@smretail.com.')).toBeVisible()
    await expect(email(page)).toHaveAttribute('aria-invalid', 'true')
    await expectAccessible(page)

    // Domain not allowed: refused in the browser, no account call.
    await email(page).fill('someone@gmail.com')
    await submit(page).click()
    await expect(page.getByRole('alert').filter({ hasText: "This work email domain isn't allowed." })).toBeVisible()
    await expectAccessible(page)
    expect(awsCalls, 'no request may reach Cognito for an outside domain').toEqual([])
  })

  test('"Set one up" opens SCR-002 first sign-in (verify email step)', async ({ page }) => {
    await withFakeCognito(page)
    await openSignIn(page)
    await email(page).fill('juan@smretail.com')
    await page.getByRole('link', { name: /New here, or no passkey on this device\? Set one up/ }).click()
    await expect(page).toHaveURL(/\/first-sign-in$/)
    await expect(heading(page)).toHaveText('Set up your passkey')
    const steps = page.getByRole('list', { name: 'Setup steps' })
    await expect(steps.getByRole('listitem')).toHaveCount(3)
    await expect(steps.locator('[aria-current="step"]')).toContainText('Verify email')
    await expect(page.getByRole('heading', { level: 2, name: 'Verify your email' })).toBeVisible()
    await expectAccessible(page)
  })

  test('an allowed-domain passkey attempt with Cognito unreachable shows a failure state, then "Use an email code" opens SCR-002', async ({ page }) => {
    const awsCalls = await withFakeCognito(page)
    await openSignIn(page)
    await email(page).fill('juan@smretail.com')
    await submit(page).click()

    // Cognito is unreachable (every AWS request aborted): no crash, a failure message.
    const failure = page
      .getByRole('alert')
      .filter({ hasText: /Sign-in isn’t available right now\.|passkey/i })
      .first()
    await expect(failure).toBeVisible()
    await expect(heading(page)).toHaveText('Sign in to LaneWise')
    expect(awsCalls.length, 'the attempt went to (blocked) Cognito').toBeGreaterThan(0)
    await expectAccessible(page)

    const useCode = page.getByRole('button', { name: 'Use an email code' })
    if (await useCode.isVisible()) {
      await useCode.click()
    } else {
      // "Unavailable" offers no email-code button; the setup link does the same.
      await page.getByRole('link', { name: /Set one up/ }).click()
    }
    await expect(page).toHaveURL(/\/first-sign-in$/)
    await expect(heading(page)).toHaveText('Set up your passkey')
    await expectAccessible(page)
  })

  test.fixme('full passkey ceremony: email code → create passkey → choose role → Home', async () => {
    // Needs a real Cognito user pool (email OTP + WebAuthn registration);
    // not automatable against the mock dev server.
  })
})
