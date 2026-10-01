import { describe, expect, it } from 'vitest'
import { DEFAULT_SCENARIO_SETTINGS } from '@lanewise/shared'
import { listQueryString } from './api'
import {
  comparePath,
  filtersFromSearch,
  filtersToSearch,
  growthToPct,
  issuesFromDetails,
  pctToGrowth,
  settingsPath,
  toForm,
  validateForm,
} from './logic'

describe('scenario settings form', () => {
  it('shows growth as a percentage and back without float noise', () => {
    expect(growthToPct(1.05)).toBe('5')
    expect(growthToPct(0.9)).toBe('-10')
    expect(growthToPct(1.075)).toBe('7.5')
    expect(pctToGrowth('5')).toBe(1.05)
    expect(pctToGrowth('-10')).toBe(0.9)
    expect(pctToGrowth('')).toBeNaN()
    for (const g of [0.5, 0.97, 1, 1.03, 1.08, 2]) expect(pctToGrowth(growthToPct(g))).toBe(g)
  })

  it('validates with the shared validator and reports issue keys', () => {
    const form = toForm(DEFAULT_SCENARIO_SETTINGS)
    expect(validateForm(form)).toEqual({ ok: true, settings: DEFAULT_SCENARIO_SETTINGS })
    const bad = validateForm({ ...form, growthPct: '500', peakDay: '2027-01-15' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect([...bad.issues].sort()).toEqual(['growth', 'peakDay'])
    const empty = validateForm({ ...form, growthPct: '' })
    expect(empty.ok).toBe(false)
  })

  it('maps server validation details to setting keys', () => {
    expect([...issuesFromDetails([{ path: 'body.settings.growth' }, { path: 'body.name' }, { path: 'body.settings.peakDay' }])]).toEqual([
      'growth',
      'peakDay',
    ])
  })
})

describe('list filters and paths', () => {
  it('round-trips filters through the URL', () => {
    const f = { q: 'xmas', status: 'draft' as const, season: 'christmas-2026', stale: true }
    expect(filtersFromSearch(filtersToSearch(f))).toEqual(f)
    expect(filtersToSearch({ q: '', status: '', season: '', stale: false })).toBe('')
    expect(filtersFromSearch('')).toEqual({ q: '', status: '', season: '', stale: false })
  })

  it('builds the API query, leaving empty filters out', () => {
    expect(listQueryString({ status: 'draft', stale: true, q: ' v4 ' })).toBe('?status=draft&stale=true&q=v4')
    expect(listQueryString({ status: '', season: '', stale: false, q: '' })).toBe('')
  })

  it('builds screen paths', () => {
    expect(settingsPath('scn 1')).toBe('/scenarios/scn%201/settings')
    expect(comparePath('a1')).toBe('/scenarios/compare?a=a1')
    expect(comparePath('a1', 'b2')).toBe('/scenarios/compare?a=a1&b=b2')
    expect(comparePath()).toBe('/scenarios/compare')
  })
})
