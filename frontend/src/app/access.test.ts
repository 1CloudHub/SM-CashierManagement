import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { ROLE_CODES, type RoleCode } from '@lanewise/shared'
import fc from 'fast-check'
import { generatePath } from 'react-router'
import { describe, expect, it } from 'vitest'
import { canAccess, canStayOn, navForRole, screenForPath } from './access'
import { NAV, SCREEN_BY_ID, SCREENS, type ScreenId } from './screens'

const role = fc.constantFrom(...ROLE_CODES)
const WIREFRAMES = path.resolve(import.meta.dirname, '../../../.kiro/specs/cashier-staffing-planner/wireframes')

function screenIdOf(file: string): ScreenId {
  return `SCR-${/scr-(\d{3})/.exec(file)![1]}` as ScreenId
}

function roleSet(codes: string): RoleCode[] {
  return codes.trim().split(/\s+/).map((c) => c.toUpperCase() as RoleCode).sort()
}

describe('nav filtering (requirement 2.3)', () => {
  it('property: every visible nav item is permitted for the role, and every permitted item is visible', () => {
    fc.assert(
      fc.property(role, (r) => {
        const visible = navForRole(r).flatMap((s) => s.items.map((i) => i.screen))
        for (const id of visible) expect(canAccess(r, id)).toBe(true)
        const permitted = NAV.flatMap((s) => s.items.map((i) => i.screen)).filter((id) => canAccess(r, id))
        expect(visible).toEqual(permitted)
      }),
    )
  })

  it('property: no section is shown empty (hidden, never disabled)', () => {
    fc.assert(
      fc.property(role, (r) => {
        for (const section of navForRole(r)) expect(section.items.length).toBeGreaterThan(0)
      }),
    )
  })

  it('property: every nav href routes back to its own screen', () => {
    fc.assert(
      fc.property(role, (r) => {
        for (const item of navForRole(r).flatMap((s) => s.items)) {
          expect(screenForPath(item.href)?.id).toBe(item.screen)
        }
      }),
    )
  })

  it('Home is visible to every role; Staff sees only Home and My roster', () => {
    for (const r of ROLE_CODES) expect(navForRole(r)[0].items[0].screen).toBe('SCR-010')
    expect(navForRole('STF').flatMap((s) => s.items.map((i) => i.screen))).toEqual(['SCR-010', 'SCR-025'])
  })
})

describe('parity with the wireframes', () => {
  it('nav groups, order and roles match the wireframe NAV table (_build.py)', () => {
    const src = readFileSync(path.join(WIREFRAMES, '_build.py'), 'utf8')
    const vars: Record<string, string> = {}
    for (const m of src.matchAll(/^(\w+)="([a-z ]+)"$/gm)) vars[m[1]] = m[2]
    const navSrc = /^NAV=\[([\s\S]*?)^\]/m.exec(src)![1]
    const wireframe = [...navSrc.matchAll(/\("(scr-\d{3}-[\w-]+\.html)","[^"]*","[^"]*",(?:"([a-z ]+)"|(\w+))\)/g)].map((m) => ({
      screen: screenIdOf(m[1]),
      roles: roleSet(m[2] ?? vars[m[3]]),
    }))
    const ours = NAV.flatMap((s) => s.items).map((i) => ({
      screen: i.screen,
      roles: [...SCREEN_BY_ID[i.screen].roles].sort(),
    }))
    expect(ours).toEqual(wireframe)
    const groups = [...navSrc.matchAll(/^ \((None|"(\w+)"),\[/gm)].map((m) => m[2] ?? null)
    expect(NAV.map((s) => (s.titleKey ? s.titleKey.replace('nav.section.', '') : null))).toEqual(
      groups.map((g) => (g ? g.toLowerCase() : null)),
    )
  })

  it('each screen’s roles match its wireframe page (data-page-roles)', () => {
    const files = readdirSync(WIREFRAMES).filter((f) => /^scr-0[1-9]\d-.*\.html$/.test(f))
    expect(files.length).toBe(SCREENS.length)
    for (const file of files) {
      const html = readFileSync(path.join(WIREFRAMES, file), 'utf8')
      const roles = roleSet(/data-page-roles="([^"]+)"/.exec(html)![1])
      expect([...SCREEN_BY_ID[screenIdOf(file)].roles].sort(), file).toEqual(roles)
    }
  })
})

describe('route matching', () => {
  const segment = fc.stringMatching(/^[a-z0-9-]{1,12}$/).filter((s) => s !== 'compare' && s !== 'invite')

  it('property: every screen path resolves back to that screen', () => {
    fc.assert(
      fc.property(segment, (id) => {
        for (const screen of SCREENS) {
          const params = Object.fromEntries((screen.path.match(/:\w+/g) ?? []).map((p) => [p.slice(1), id]))
          expect(screenForPath(generatePath(screen.path, params))?.id).toBe(screen.id)
        }
      }),
    )
  })

  it('static segments win over params, unknown paths match nothing', () => {
    expect(screenForPath('/scenarios/compare')?.id).toBe('SCR-032')
    expect(screenForPath('/admin/users/invite')?.id).toBe('SCR-071')
    expect(screenForPath('/nope')).toBeNull()
  })

  it('property: a role may stay on a page exactly when it can access that screen (unknown paths stay)', () => {
    fc.assert(
      fc.property(role, fc.constantFrom(...SCREENS), (r, screen) => {
        const concrete = screen.path.replace(/:\w+/g, 'x1')
        expect(canStayOn(r, concrete)).toBe(canAccess(r, screen))
        expect(canStayOn(r, '/not-a-screen')).toBe(true)
      }),
    )
  })
})
