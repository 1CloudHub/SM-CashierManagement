import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  COST_LEVELS,
  CostFigure,
  ROLE_CODES,
  UntaggedCostFieldError,
  can,
  canSeeCost,
  costFigure,
  costLevelsFor,
  isStoreInScope,
  shapeCost,
  type CostTarget,
  type CostViewer,
  type RoleCode,
  type Scope,
  type StoreRef,
} from '../src/index.js';

const STORES: readonly StoreRef[] = [
  { id: 's1', regionId: 'r1' },
  { id: 's2', regionId: 'r1' },
  { id: 's3', regionId: 'r2' },
];

const roleArb = fc.constantFrom<RoleCode | null>(...ROLE_CODES, null);
const storeArb = fc.constantFrom(...STORES);
const scopeArb: fc.Arbitrary<Scope | null> = fc.oneof(
  fc.constant(null),
  fc.constant<Scope>({ type: 'global' }),
  fc.subarray(['r1', 'r2', 'r9'], { minLength: 1 }).map((regionIds): Scope => ({ type: 'region', regionIds })),
  fc.subarray(['s1', 's2', 's3', 's9'], { minLength: 1 }).map((storeIds): Scope => ({ type: 'store', storeIds })),
  fc.constant<Scope>({ type: 'self', staffId: 'st1' }),
);
const viewerArb: fc.Arbitrary<CostViewer> = fc.record({ role: roleArb, scope: scopeArb });
const targetArb: fc.Arbitrary<CostTarget> = fc.oneof(
  fc.constant<CostTarget>({ level: 'network' }),
  fc
    .tuple(fc.constantFrom('store', 'department', 'individual' as const), storeArb)
    .map(([level, store]): CostTarget => ({ level, store })),
);

describe('costLevelsFor (requirement 25, matrix "Cost figures (₱)")', () => {
  it('grants cost only to roles the matrix grants it, and never to Staff', () => {
    for (const role of ROLE_CODES) {
      const levels = costLevelsFor(role);
      expect(levels.length > 0).toBe(can(role, 'cost_figures', 'view') && role !== 'STF');
    }
    expect(costLevelsFor('STF')).toEqual([]);
    expect(costLevelsFor('ADM')).toEqual([]);
    expect(costLevelsFor('RST')).toEqual([]);
    expect(costLevelsFor(null)).toEqual([]);
  });

  it('gives EXE/PLN/HR/FIN every level and a Store Manager everything but network', () => {
    for (const role of ['EXE', 'PLN', 'HR', 'FIN'] as const) expect(costLevelsFor(role)).toEqual([...COST_LEVELS]);
    expect(costLevelsFor('STM')).toEqual(['store', 'department', 'individual']);
  });
});

describe('canSeeCost', () => {
  it('property: permitted iff the role has the level and the target is in scope', () => {
    fc.assert(
      fc.property(viewerArb, targetArb, (viewer, target) => {
        const { role, scope } = viewer;
        let expected = scope !== null && scope.type !== 'self' && costLevelsFor(role).includes(target.level);
        if (expected && scope) {
          expected =
            target.level === 'network'
              ? scope.type === 'global' || scope.type === 'region'
              : isStoreInScope(scope, target.store);
        }
        expect(canSeeCost(viewer, target)).toBe(expected);
      }),
      { numRuns: 500 },
    );
  });

  it('property P11: Staff never see any cost, whatever the scope or target', () => {
    fc.assert(
      fc.property(scopeArb, targetArb, (scope, target) => {
        expect(canSeeCost({ role: 'STF', scope }, target)).toBe(false);
      }),
    );
  });

  it('property 25.1: a Store Manager sees own-store cost only and never network cost', () => {
    fc.assert(
      fc.property(scopeArb, targetArb, (scope, target) => {
        const seen = canSeeCost({ role: 'STM', scope }, target);
        if (target.level === 'network') expect(seen).toBe(false);
        else expect(seen).toBe(scope !== null && isStoreInScope(scope, target.store));
      }),
    );
  });
});

/** A random response body with cost figures at random places. */
interface Tree {
  [key: string]: unknown;
}
const leafArb = fc.oneof(fc.integer(), fc.string(), fc.boolean(), fc.constant(null));
const figureArb = fc.tuple(targetArb, fc.integer({ min: 1, max: 10_000_000 })).map(([t, v]) => costFigure(t, v));
const nameArb = fc.constantFrom('a', 'b', 'label', 'rows', 'kpis');
const { tree: treeArb } = fc.letrec<{ tree: Tree; node: unknown }>((tie) => ({
  tree: fc.record({
    plain: fc.dictionary(nameArb, tie('node'), { maxKeys: 3 }),
    costs: fc.dictionary(fc.constantFrom('cost', 'seasonCost', 'draftCost', 'laborCost'), figureArb, { maxKeys: 2 }),
  }).map(({ plain, costs }) => ({ ...plain, ...costs })),
  node: fc.oneof({ depthSize: 'small' }, leafArb, tie('tree'), fc.array(tie('tree'), { maxLength: 2 })),
}));

/** Every [path, figure] in a draft. */
function figures(value: unknown, path = ''): [string, CostFigure][] {
  if (Array.isArray(value)) return value.flatMap((v, i) => figures(v, `${path}[${i}]`));
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([k, v]) => {
    const p = path === '' ? k : `${path}.${k}`;
    return v instanceof CostFigure ? [[p, v] as [string, CostFigure]] : figures(v, p);
  });
}

function at(value: unknown, path: string): { present: boolean; value?: unknown } {
  let cur: unknown = value;
  for (const part of path.match(/[^.[\]]+/g) ?? []) {
    if (typeof cur !== 'object' || cur === null || !(part in cur)) return { present: false };
    cur = (cur as Record<string, unknown>)[part];
  }
  return { present: true, value: cur };
}

describe('shapeCost', () => {
  it('property: each cost field is present (with its value) iff the viewer may see it', () => {
    fc.assert(
      fc.property(treeArb, viewerArb, (draft, viewer) => {
        const shaped = shapeCost<unknown>(draft, viewer);
        for (const [path, figure] of figures(draft)) {
          const found = at(shaped, path);
          if (canSeeCost(viewer, figure.target)) expect(found).toEqual({ present: true, value: figure.value });
          else expect(found.present).toBe(false);
        }
        expect(figures(shaped)).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });

  it('property P11: a Staff body carries no cost field at all', () => {
    fc.assert(
      fc.property(treeArb, scopeArb, (draft, scope) => {
        const json = JSON.stringify(shapeCost<unknown>(draft, { role: 'STF', scope }));
        expect(json).not.toMatch(/cost/i);
      }),
    );
  });

  it('does not change the draft', () => {
    const draft = { kpis: { seasonCost: costFigure({ level: 'network' }, 5) } };
    shapeCost(draft, { role: 'FIN', scope: { type: 'global' } });
    expect(draft.kpis.seasonCost).toBeInstanceOf(CostFigure);
  });

  it('fails closed on a cost-named number that was not wrapped', () => {
    expect(() => shapeCost({ rows: [{ laborCost: 12 }] }, { role: 'FIN', scope: { type: 'global' } })).toThrow(
      UntaggedCostFieldError,
    );
    expect(() => shapeCost({ rows: [{ laborCost: 12 }] }, { role: 'FIN', scope: { type: 'global' } })).toThrow(
      /rows\[0\]\.laborCost/,
    );
  });

  it('rejects a cost figure as an array element', () => {
    expect(() => shapeCost({ costs: [costFigure({ level: 'network' }, 1)] }, { role: 'FIN', scope: { type: 'global' } })).toThrow(
      /array element/,
    );
  });

  it('an unshaped figure serialises to nothing', () => {
    expect(JSON.stringify({ cost: costFigure({ level: 'network' }, 322_000), n: 1 })).toBe('{"n":1}');
  });
});
