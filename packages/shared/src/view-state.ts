/**
 * URL view state (design.md › Search and filter › URL state; requirement
 * 21.3/21.4; P8 filter round-trip).
 *
 * Every context-bar filter, the sort and the scenario live in the query
 * string (`?scenario=…&region=…&store=…&dept=…&date=…&sort=…`), so a view can
 * be shared or bookmarked, and a saved view is just such a query string.
 * `encodeViewState` is canonical (fixed parameter order, empty values
 * dropped), so the same view always yields the same URL; `decodeViewState`
 * ignores unknown parameters and drops malformed values. Loading a URL
 * applies the loader's own scope with `restrictViewState`: a value the loader
 * cannot see (another region's store, say) is dropped, never shown. The
 * server enforces scope regardless (P1); this only keeps the UI honest.
 */

/** The URL parameters a view may carry, in canonical (context-bar) order. */
export const VIEW_PARAMS = ['scenario', 'region', 'format', 'store', 'dept', 'date', 'season', 'weeks', 'sort'] as const;
export type ViewParam = (typeof VIEW_PARAMS)[number];

/** A view: each parameter's value, absent when unset. */
export type ViewState = Partial<Record<ViewParam, string>>;

/**
 * The values the loader may pick for each parameter (the context bar's
 * options, already scope-filtered by the server). A parameter that is absent
 * here is free-form (date, sort, weeks) and only format-checked.
 */
export type ViewOptions = Partial<Record<ViewParam, readonly string[]>>;

/** Longest value kept for any parameter; longer ones are dropped. */
export const VIEW_VALUE_MAX = 200;
/** Longest encoded view (a saved view's `query`). */
export const VIEW_QUERY_MAX = 2000;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SORT = /^-?[a-z][a-zA-Z0-9_.]{0,40}$/;

function isCalendarDate(value: string): boolean {
  const m = DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function isValid(param: ViewParam, value: string): boolean {
  switch (param) {
    case 'date':
      return isCalendarDate(value);
    case 'weeks': {
      if (!/^\d{1,2}$/.test(value)) return false;
      const n = Number(value);
      return n >= 1 && n <= 52 && String(n) === value;
    }
    case 'sort':
      return SORT.test(value);
    default:
      return true;
  }
}

/** Parses a query string (with or without the leading `?`). First value wins. */
export function decodeViewState(search: string): ViewState {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const state: ViewState = {};
  for (const param of VIEW_PARAMS) {
    const raw = params.get(param);
    if (raw === null) continue;
    const value = raw.trim();
    if (value.length === 0 || value.length > VIEW_VALUE_MAX || !isValid(param, value)) continue;
    state[param] = value;
  }
  return state;
}

/** The canonical query string for a view (no leading `?`; `''` for an empty view). */
export function encodeViewState(state: ViewState): string {
  const params = new URLSearchParams();
  for (const param of VIEW_PARAMS) {
    const value = state[param];
    if (value !== undefined && value.length > 0) params.set(param, value);
  }
  return params.toString();
}

/** Drops every listed value the loader's options don't include (P8 "subject to the loader's scope"). */
export function restrictViewState(state: ViewState, options: ViewOptions): ViewState {
  const out: ViewState = {};
  for (const param of VIEW_PARAMS) {
    const value = state[param];
    if (value === undefined) continue;
    const allowed = options[param];
    if (allowed === undefined || allowed.includes(value)) out[param] = value;
  }
  return out;
}

/** Normalises an untrusted query string to its canonical form (saved views store this). */
export function normalizeViewQuery(search: string): string {
  return encodeViewState(decodeViewState(search));
}
