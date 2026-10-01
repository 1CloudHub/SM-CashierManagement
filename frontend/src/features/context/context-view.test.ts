import { encodeViewState, decodeViewState, SAVED_VIEW_SCREENS, type ViewState } from '@lanewise/shared'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { ContextOptions } from '@/api'
import { MOCK_DEPARTMENTS, MOCK_REGIONS, MOCK_SCENARIOS, MOCK_SEASONS, MOCK_STORES } from '@/api/mock-directory'
import { clearDependents, resolveView, SCREEN_CONTEXT } from './context-view'

/** A loader's scope: any subset of the mock network (what the server would send them). */
const optionsArb: fc.Arbitrary<ContextOptions> = fc
  .tuple(fc.subarray(MOCK_STORES.map((s) => s.id)), fc.subarray(MOCK_SCENARIOS.map((s) => s.id)))
  .map(([storeIds, scenarioIds]) => {
    const stores = MOCK_STORES.filter((s) => storeIds.includes(s.id))
    return {
      scenarios: MOCK_SCENARIOS.filter((s) => scenarioIds.includes(s.id)),
      regions: MOCK_REGIONS.filter((r) => stores.some((s) => s.regionId === r.id)),
      formats: [...new Set(stores.map((s) => s.format))],
      stores,
      departments: MOCK_DEPARTMENTS.filter((d) => storeIds.includes(d.storeId)),
      seasons: MOCK_SEASONS,
    }
  })

const screenArb = fc.constantFrom(...SAVED_VIEW_SCREENS)

/** A view a user could have built from the context bar under `options`. */
function viewArb(screen: (typeof SAVED_VIEW_SCREENS)[number], options: ContextOptions): fc.Arbitrary<ViewState> {
  const fields = SCREEN_CONTEXT[screen]
  const pick = <T,>(xs: readonly T[]) => (xs.length === 0 ? fc.constant(undefined) : fc.option(fc.constantFrom(...xs), { nil: undefined }))
  return fc
    .record({
      scenario: pick(options.scenarios.map((s) => s.id)),
      region: pick(options.regions.map((r) => r.id)),
      format: pick(options.formats),
      season: pick(options.seasons.map((s) => s.id)),
      date: fc.option(fc.constantFrom('2026-12-19', '2026-12-24'), { nil: undefined }),
      sort: fc.option(fc.constantFrom('-gap', 'name'), { nil: undefined }),
      storeIndex: fc.nat(),
      deptIndex: fc.nat(),
    })
    .map(({ storeIndex, deptIndex, ...r }) => {
      const state: ViewState = {}
      for (const [k, v] of Object.entries(r)) if (v !== undefined && (fields.includes(k as never) || k === 'sort')) state[k as keyof ViewState] = v
      // Pick store and department the way the cascading selects offer them.
      const stores = options.stores.filter((s) => (!state.region || s.regionId === state.region) && (!state.format || s.format === state.format))
      if (fields.includes('store') && stores.length > 0 && storeIndex % 3 !== 0) state.store = stores[storeIndex % stores.length]!.id
      const depts = options.departments.filter((d) => !state.store || d.storeId === state.store)
      if (fields.includes('dept') && depts.length > 0 && deptIndex % 3 !== 0) state.dept = depts[deptIndex % depts.length]!.id
      return state
    })
}

describe('P8 filter round-trip through the context bar', () => {
  it('a shared URL reproduces the same filters, sort and scenario for a loader with the same scope', () => {
    fc.assert(
      fc.property(
        screenArb.chain((screen) => optionsArb.chain((options) => fc.tuple(fc.constant(screen), fc.constant(options), viewArb(screen, options)))),
        ([screen, options, view]) => {
          const url = encodeViewState(view)
          expect(resolveView(SCREEN_CONTEXT[screen], options, decodeViewState(url)).state).toEqual(view)
        },
      ),
    )
  })

  it("for any other loader, keeps exactly what the loader's scope allows and nothing outside it", () => {
    fc.assert(
      fc.property(
        screenArb.chain((screen) => optionsArb.chain((options) => fc.tuple(fc.constant(screen), viewArb(screen, options)))),
        optionsArb,
        ([screen, view], loader) => {
          const { state, allowed } = resolveView(SCREEN_CONTEXT[screen], loader, decodeViewState(encodeViewState(view)))
          for (const [param, value] of Object.entries(state)) {
            if (param === 'date' || param === 'sort') expect(value).toBe(view[param])
            else expect(allowed[param as keyof typeof allowed], param).toContain(value)
          }
          // Nothing the loader can't see survives.
          if (state.store) expect(loader.stores.map((s) => s.id)).toContain(state.store)
          if (state.dept) expect(loader.departments.map((d) => d.id)).toContain(state.dept)
          if (state.scenario) expect(loader.scenarios.map((s) => s.id)).toContain(state.scenario)
          // Cascade stays consistent: the store is in the region/format, the department in the store.
          const store = loader.stores.find((s) => s.id === state.store)
          if (store && state.region) expect(store.regionId).toBe(state.region)
          if (store && state.format) expect(store.format).toBe(state.format)
          const dept = loader.departments.find((d) => d.id === state.dept)
          if (dept && state.store) expect(dept.storeId).toBe(state.store)
          // Whatever the loader could have picked is kept as-is.
          for (const p of ['scenario', 'region', 'format', 'season', 'date', 'sort'] as const) {
            if (view[p] !== undefined && (p === 'date' || p === 'sort' || (allowed[p] ?? []).includes(view[p]!))) {
              expect(state[p]).toBe(view[p])
            }
          }
        },
      ),
    )
  })

  it('shows only the filters that apply to the screen', () => {
    const everything = decodeViewState('scenario=scn-xmas-2026-v3&region=reg-luzon&format=savemore&store=st-lp&dept=st-lp-d1&date=2026-12-19&season=nov02-dec31')
    const options: ContextOptions = {
      scenarios: MOCK_SCENARIOS,
      regions: MOCK_REGIONS,
      formats: ['savemore'],
      stores: MOCK_STORES,
      departments: MOCK_DEPARTMENTS,
      seasons: MOCK_SEASONS,
    }
    expect(Object.keys(resolveView(SCREEN_CONTEXT['SCR-022'], options, everything).state).sort()).toEqual(['dept', 'scenario', 'store'])
    expect(Object.keys(resolveView(SCREEN_CONTEXT['SCR-023'], options, everything).state).sort()).toEqual(['format', 'region', 'scenario', 'season'])
  })

  it('changing a filter clears the ones it narrows', () => {
    expect(clearDependents({ region: 'a', store: 's', dept: 'd', date: '2026-12-19' }, 'region')).toEqual({ region: 'a', date: '2026-12-19' })
    expect(clearDependents({ store: 's', dept: 'd' }, 'store')).toEqual({ store: 's' })
    expect(clearDependents({ scenario: 'x', store: 's' }, 'scenario')).toEqual({ scenario: 'x', store: 's' })
  })
})
