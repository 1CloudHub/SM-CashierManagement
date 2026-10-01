/**
 * Property 8 — filter round-trip (requirement 21.3/21.4; task 20).
 *
 *   Loading a shared URL reproduces the same filters, sort and scenario that
 *   produced it, subject to the loader's scope.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  VIEW_PARAMS,
  decodeViewState,
  encodeViewState,
  restrictViewState,
  type ViewOptions,
  type ViewParam,
  type ViewState,
} from '../src/index.js';

const LISTED: readonly ViewParam[] = ['scenario', 'region', 'format', 'store', 'dept', 'season'];

/** Opaque ids/keys as the context bar offers them (uuids, codes, season keys). */
const token = fc.oneof(
  fc.uuid(),
  fc.stringMatching(/^[a-z0-9][a-z0-9_-]{0,15}$/),
  // Awkward but legal characters must survive URL encoding.
  fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim() === s && s.length > 0),
);

const optionsArb: fc.Arbitrary<ViewOptions> = fc.record(
  Object.fromEntries(LISTED.map((p) => [p, fc.uniqueArray(token, { minLength: 1, maxLength: 6 })])) as Record<
    string,
    fc.Arbitrary<string[]>
  >,
) as fc.Arbitrary<ViewOptions>;

const dateArb = fc
  .date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2030-12-31T00:00:00Z'), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));
const sortArb = fc.stringMatching(/^-?[a-z][a-zA-Z0-9_.]{0,20}$/);
const weeksArb = fc.integer({ min: 1, max: 52 }).map(String);

/** A view state whose listed values all come from `options`. */
function stateWithin(options: ViewOptions): fc.Arbitrary<ViewState> {
  const parts: Record<string, fc.Arbitrary<string | undefined>> = {};
  for (const p of LISTED) parts[p] = fc.option(fc.constantFrom(...(options[p] ?? [])), { nil: undefined });
  parts.date = fc.option(dateArb, { nil: undefined });
  parts.sort = fc.option(sortArb, { nil: undefined });
  parts.weeks = fc.option(weeksArb, { nil: undefined });
  return fc.record(parts).map((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)) as ViewState);
}

describe('P8 filter round-trip', () => {
  it('decoding an encoded view reproduces it exactly, and restricting to the same options changes nothing', () => {
    fc.assert(
      fc.property(optionsArb.chain((o) => fc.tuple(fc.constant(o), stateWithin(o))), ([options, state]) => {
        const url = encodeViewState(state);
        expect(decodeViewState(url)).toEqual(state);
        expect(decodeViewState(`?${url}`)).toEqual(state);
        expect(restrictViewState(decodeViewState(url), options)).toEqual(state);
      }),
    );
  });

  it("a loader with a different scope gets the same view minus what is outside the loader's options", () => {
    fc.assert(
      fc.property(
        optionsArb.chain((o) => fc.tuple(fc.constant(o), stateWithin(o), optionsArb)),
        fc.boolean(),
        ([sharerOptions, state, loaderOptions], overlap) => {
          // Optionally let the loader see some of the sharer's options.
          const loader: ViewOptions = overlap
            ? Object.fromEntries(
                LISTED.map((p) => [p, [...(loaderOptions[p] ?? []), ...(sharerOptions[p] ?? []).slice(0, 2)]]),
              )
            : loaderOptions;
          const loaded = restrictViewState(decodeViewState(encodeViewState(state)), loader);
          for (const p of VIEW_PARAMS) {
            const value = state[p];
            const allowed = loader[p];
            const keep = value !== undefined && (allowed === undefined || allowed.includes(value));
            expect(loaded[p]).toBe(keep ? value : undefined);
          }
        },
      ),
    );
  });

  it('encoding is canonical: parameter order and unknown or empty parameters never matter', () => {
    fc.assert(
      fc.property(
        optionsArb.chain((o) => stateWithin(o)),
        fc.dictionary(fc.stringMatching(/^[a-z]{1,8}$/), fc.string({ maxLength: 8 })),
        (state, junk) => {
          const params = new URLSearchParams();
          const entries = Object.entries(state).reverse();
          for (const [k, v] of Object.entries(junk)) {
            if (!(VIEW_PARAMS as readonly string[]).includes(k)) params.append(k, v);
          }
          for (const [k, v] of entries) params.append(k, v);
          expect(encodeViewState(decodeViewState(params.toString()))).toBe(encodeViewState(state));
        },
      ),
    );
  });

  it('drops malformed values instead of trusting them', () => {
    expect(decodeViewState('date=2026-13-40&weeks=0&sort=DROP%20TABLE&store=&region=%20')).toEqual({});
    expect(decodeViewState('date=2026-12-19&weeks=4&sort=-gap&store=a&store=b')).toEqual({
      date: '2026-12-19',
      weeks: '4',
      sort: '-gap',
      store: 'a',
    });
    expect(decodeViewState(`store=${'x'.repeat(201)}`)).toEqual({});
  });
});
