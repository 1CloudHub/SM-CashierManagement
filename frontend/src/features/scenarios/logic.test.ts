import { describe, expect, it } from 'vitest'
import { DEFAULT_SCENARIO_SETTINGS } from '@lanewise/shared'
import { listQueryString } from './api'
import {
  blockerFromError,
  comparePath,
  deptIssueId,
  formEquals,
  hasActiveFilters,
  issuesAfterBlur,
  listRowBlocker,
  scenarioHref,
  settingsBlocker,
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

  it('maps server validation details to setting keys and department rows', () => {
    expect([...issuesFromDetails([{ path: 'body.settings.growth' }, { path: 'body.name' }, { path: 'body.settings.peakDay' }])]).toEqual([
      'growth',
      'peakDay',
    ])
    const submitted = {
      ...DEFAULT_SCENARIO_SETTINGS,
      departmentOverrides: [{ departmentId: 'd-ceb', baselineTxPerDay: null, handleTimeMin: 99, upliftPct: null }],
    }
    expect([...issuesFromDetails([{ path: 'body.settings.departmentOverrides.0.handleTimeMin' }], submitted)]).toEqual([
      deptIssueId('d-ceb', 'handleTimeMin'),
    ])
  })

  it('treats an empty override as the rule default and validates overrides', () => {
    const form = toForm(DEFAULT_SCENARIO_SETTINGS)
    const edited = { ...form, numeric: { ...form.numeric, ftMaxDaysPerWeek: '5' } }
    const v = validateForm(edited)
    expect(v.ok && v.settings.ftMaxDaysPerWeek).toBe(5)
    expect(validateForm({ ...form, numeric: { ...form.numeric, ftMaxDaysPerWeek: '9' } })).toEqual({ ok: false, issues: new Set(['ftMaxDaysPerWeek']) })
    // An emptied override is not a change; an empty department row is ignored.
    expect(formEquals({ ...edited, numeric: { ...edited.numeric, ftMaxDaysPerWeek: '' } }, form)).toBe(true)
    expect(formEquals({ ...form, departments: { 'd-1': { baselineTxPerDay: '', handleTimeMin: '', upliftPct: '' } } }, form)).toBe(true)
    const dept = validateForm({ ...form, departments: { 'd-1': { baselineTxPerDay: '', handleTimeMin: '0', upliftPct: '' } } })
    expect(dept).toEqual({ ok: false, issues: new Set([deptIssueId('d-1', 'handleTimeMin')]) })
  })

  it('validates on blur only the fields related to the one that lost focus', () => {
    const form = toForm(DEFAULT_SCENARIO_SETTINGS)
    const bad = { ...form, growthPct: '500', planningTo: '2026-11-01' }
    expect([...issuesAfterBlur(bad, new Set(), 'growth')]).toEqual(['growth'])
    expect([...issuesAfterBlur(bad, new Set(['growth']), 'planningTo')].sort()).toEqual(['growth', 'peakDay', 'planningTo'])
    expect([...issuesAfterBlur(form, new Set(['growth', 'planningTo']), 'growth')]).toEqual(['planningTo'])
  })

  it('blocks Submit for unsaved edits with its own reason', () => {
    expect(settingsBlocker(null, true)).toBe('unsaved')
    expect(settingsBlocker('stale', false)).toBe('stale')
    expect(settingsBlocker(null, false)).toBeNull()
  })
})

describe('list rows', () => {
  it('derives the submit blocker for a row and from a refused submit', () => {
    expect(listRowBlocker({ status: 'draft', stale: true, lastRunAt: '2026-09-01T00:00:00Z' })).toBe('stale')
    expect(listRowBlocker({ status: 'draft', stale: false, lastRunAt: null })).toBe('not_run')
    expect(listRowBlocker({ status: 'draft', stale: false, lastRunAt: '2026-09-01T00:00:00Z' })).toBeNull()
    expect(blockerFromError('conflict', 'This scenario is stale. Recalculate it before submitting.')).toBe('stale')
    expect(blockerFromError('conflict', 'Run this scenario before submitting it.')).toBe('not_run')
    expect(blockerFromError('not_found', 'stale')).toBeNull()
  })

  it('links a scenario name to a screen the role can open', () => {
    const published = { id: 'p1', isPublished: true }
    const draft = { id: 'd1', isPublished: false }
    expect(scenarioHref('PLN', published)).toBe('/scenarios/p1/settings')
    expect(scenarioHref('STM', published)).toBe('/plan/hiring')
    expect(scenarioHref('RST', published)).toBe('/scenarios/p1/settings')
    expect(scenarioHref('FIN', draft)).toBe('/scenarios/d1/settings')
    expect(scenarioHref(null, draft)).toBeNull()
  })
})

describe('list filters and paths', () => {
  it('round-trips filters through the URL', () => {
    const f = { q: 'xmas', status: 'draft' as const, season: 'christmas-2026', stale: true, owner: 'me' as const }
    expect(filtersFromSearch(filtersToSearch(f))).toEqual(f)
    expect(hasActiveFilters(f)).toBe(true)
    const none = { q: '', status: '' as const, season: '', stale: false, owner: '' as const }
    expect(filtersToSearch(none)).toBe('')
    expect(filtersFromSearch('')).toEqual(none)
    expect(hasActiveFilters(none)).toBe(false)
    expect(filtersFromSearch('?owner=someone').owner).toBe('')
  })

  it('builds the API query, leaving empty filters out', () => {
    expect(listQueryString({ status: 'draft', stale: true, q: ' v4 ', owner: 'me' })).toBe('?status=draft&stale=true&q=v4&owner=me')
    expect(listQueryString({ status: '', season: '', stale: false, q: '' })).toBe('')
  })

  it('builds screen paths', () => {
    expect(settingsPath('scn 1')).toBe('/scenarios/scn%201/settings')
    expect(comparePath('a1')).toBe('/scenarios/compare?a=a1')
    expect(comparePath('a1', 'b2')).toBe('/scenarios/compare?a=a1&b=b2')
    expect(comparePath()).toBe('/scenarios/compare')
  })
})
