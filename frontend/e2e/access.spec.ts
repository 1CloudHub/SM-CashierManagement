import { expect, test } from '@playwright/test'
import { expectNoAccess, go, heading, open, ROLES, type Role } from './support/app'

/**
 * Role × screen access (task 25; Req 2.3, 2.4, 3; P12) across all 8 roles.
 *
 * The oracle is the design's RBAC matrix / screen inventory
 * (.kiro/specs/cashier-staffing-planner/design.md), written out here rather
 * than imported from src/app/screens.ts, so the SPA's own route guard is
 * checked against the spec and not against itself. For every role, each
 * screen it may open renders its page and every other screen renders
 * "No access" — reached client-side, as a deep link would be after sign-in.
 */
const ALL = ROLES
const SCREENS: { path: string; roles: readonly Role[] }[] = [
  { path: '/plan/network', roles: ['EXE', 'PLN', 'STM', 'HR', 'FIN', 'RST'] },
  { path: '/plan/department', roles: ['EXE', 'PLN', 'STM', 'HR', 'FIN', 'RST'] },
  { path: '/plan/roster', roles: ['EXE', 'PLN', 'STM', 'HR', 'FIN'] },
  { path: '/plan/hiring', roles: ['EXE', 'PLN', 'STM', 'HR', 'FIN'] },
  { path: '/plan/summary', roles: ['EXE', 'PLN', 'HR', 'FIN'] },
  { path: '/my-roster', roles: ['STF'] },
  { path: '/plan/map', roles: ['EXE', 'PLN', 'STM', 'HR'] },
  // RBAC matrix: scenarios view/compare for every role but ADM and STF.
  { path: '/scenarios', roles: ['EXE', 'PLN', 'STM', 'HR', 'FIN', 'RST'] },
  { path: '/scenarios/compare', roles: ['EXE', 'PLN', 'HR', 'FIN'] },
  { path: '/approvals', roles: ['EXE', 'HR', 'FIN'] },
  { path: '/notifications', roles: ALL },
  { path: '/data/sources', roles: ['ADM', 'PLN', 'RST'] },
  { path: '/data/upload', roles: ['RST'] },
  { path: '/data/stores', roles: ['EXE', 'PLN', 'STM', 'HR', 'RST'] },
  { path: '/data/staff', roles: ['PLN', 'STM', 'HR', 'RST'] },
  { path: '/rules', roles: ['EXE', 'PLN', 'HR', 'FIN', 'RST'] },
  { path: '/admin/users', roles: ['ADM'] },
  { path: '/admin/users/invite', roles: ['ADM'] },
  { path: '/admin/roles', roles: ['ADM'] },
  { path: '/admin/audit', roles: ['ADM', 'RST'] },
  // SCR-080 Profile needs the Cognito session (passkeys), which mock mode
  // has no provider for; it is covered by src/app/root.test.tsx instead.
  { path: '/help', roles: ALL },
]

for (const role of ROLES) {
  test(`${role}: opens exactly the screens the RBAC matrix allows`, async ({ page }) => {
    await open(page, '/', role)
    const wrong: string[] = []
    for (const s of SCREENS) {
      await go(page, s.path)
      const allowed = s.roles.includes(role)
      const h1 = (await heading(page).first().innerText()).trim()
      const denied = /You do not have access/.test(h1)
      if (allowed === denied) wrong.push(`${s.path}: expected ${allowed ? 'access' : 'No access'}, got "${h1}"`)
    }
    expect(wrong).toEqual([])
  })

  test(`${role}: the side nav lists only screens the role may open`, async ({ page }) => {
    await open(page, '/', role)
    const nav = page.getByRole('navigation', { name: 'Main' })
    const hrefs = await nav.getByRole('link').evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''))
    expect(hrefs.length).toBeGreaterThan(0)
    for (const href of hrefs) {
      const s = SCREENS.find((x) => x.path === href.split('?')[0])
      if (s) expect(s.roles, `${role} nav shows ${href}`).toContain(role)
    }
  })
}

test('an out-of-scope deep link reveals nothing about the object (Req 2.4)', async ({ page }) => {
  await open(page, '/approvals?scenario=scn-ber-2026-v1', 'PLN')
  await expectNoAccess(page)
  await expect(page.getByText('Ber months 2026')).toHaveCount(0)
})
