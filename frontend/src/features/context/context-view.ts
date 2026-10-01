import { VIEW_PARAMS, type SavedViewScreen, type ViewParam, type ViewState } from '@lanewise/shared'
import type { ContextOptions } from '@/api'
import type { ScreenId } from '@/app/screens'

/**
 * The planning context bar's rules (design.md › Search and filter; task 20),
 * as pure functions so P8 can be property-tested:
 *
 *  - each screen shows only the filters that apply to it (SCREEN_CONTEXT,
 *    from the wireframes' `ctx()` calls), in the order
 *    Scenario · Region · Format · Store · Department · Date or Season;
 *  - filters narrow from left to right (a region limits the stores, a store
 *    its departments);
 *  - a URL is resolved against the loader's own options (already
 *    scope-filtered by the server), so anything outside their scope is
 *    dropped rather than shown (P8 "subject to the loader's scope").
 */

export type ContextField = Exclude<ViewParam, 'sort' | 'weeks'>

export const SCREEN_CONTEXT: Readonly<Record<SavedViewScreen, readonly ContextField[]>> = {
  'SCR-020': ['scenario', 'region', 'format', 'date'],
  'SCR-021': ['scenario', 'store', 'dept', 'date'],
  'SCR-022': ['scenario', 'store', 'dept'],
  'SCR-023': ['scenario', 'region', 'format', 'season'],
}

export function isContextScreen(id: ScreenId | string): id is SavedViewScreen {
  return Object.hasOwn(SCREEN_CONTEXT, id)
}

/** Free-form parameters kept whenever well-formed (decodeViewState checks them). */
const FREE: readonly ViewParam[] = ['date', 'sort']

export interface ResolvedView {
  /** The view as it applies to this loader: only this screen's filters, only allowed values. */
  readonly state: ViewState
  /** The values each listed filter may take given the filters to its left. */
  readonly allowed: Partial<Record<ContextField, readonly string[]>>
}

/** Resolves a decoded URL view for a screen's fields and the loader's options. */
export function resolveView(fields: readonly ContextField[], options: ContextOptions, input: ViewState): ResolvedView {
  const state: ViewState = {}
  const allowed: Partial<Record<ContextField, readonly string[]>> = {}
  for (const param of VIEW_PARAMS) {
    const value = input[param]
    if (param === 'sort') {
      if (value !== undefined) state.sort = value
      continue
    }
    if (param === 'weeks' || !fields.includes(param)) continue
    if (FREE.includes(param)) {
      if (value !== undefined) state[param] = value
      continue
    }
    const list = choicesFor(param, options, state)
    allowed[param] = list
    if (value !== undefined && list.includes(value)) state[param] = value
  }
  return { state, allowed }
}

function choicesFor(param: ContextField, options: ContextOptions, left: ViewState): string[] {
  switch (param) {
    case 'scenario':
      return options.scenarios.map((s) => s.id)
    case 'region':
      return options.regions.map((r) => r.id)
    case 'format':
      return [...options.formats]
    case 'store':
      return options.stores
        .filter((s) => (!left.region || s.regionId === left.region) && (!left.format || s.format === left.format))
        .map((s) => s.id)
    case 'dept':
      return options.departments.filter((d) => !left.store || d.storeId === left.store).map((d) => d.id)
    case 'season':
      return options.seasons.map((s) => s.id)
    case 'date':
      return []
  }
}

/** Filters each one narrows: changing it clears these (their choices change). */
const DEPENDENTS: Partial<Record<ViewParam, readonly ViewParam[]>> = {
  region: ['store', 'dept'],
  format: ['store', 'dept'],
  store: ['dept'],
}

export function clearDependents(state: ViewState, changed: ViewParam): ViewState {
  const next = { ...state }
  for (const p of DEPENDENTS[changed] ?? []) delete next[p]
  return next
}
