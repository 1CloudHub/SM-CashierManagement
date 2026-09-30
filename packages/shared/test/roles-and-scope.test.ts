import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ROLE_CODES,
  isRoleCode,
  isStoreInScope,
  type Scope,
  type StoreRef,
} from '../src/index.js';

const storeArb: fc.Arbitrary<StoreRef> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 8 }),
  regionId: fc.string({ minLength: 1, maxLength: 4 }),
});

const scopeArb: fc.Arbitrary<Scope> = fc.oneof(
  fc.constant<Scope>({ type: 'global' }),
  fc
    .array(fc.string({ minLength: 1, maxLength: 4 }), { maxLength: 5 })
    .map((regionIds): Scope => ({ type: 'region', regionIds })),
  fc
    .array(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 5 })
    .map((storeIds): Scope => ({ type: 'store', storeIds })),
  fc.string({ minLength: 1 }).map((staffId): Scope => ({ type: 'self', staffId })),
);

describe('role codes', () => {
  it('lists exactly the 8 roles of the RBAC matrix', () => {
    expect(ROLE_CODES).toEqual(['ADM', 'EXE', 'PLN', 'STM', 'HR', 'FIN', 'RST', 'STF']);
  });

  it('isRoleCode accepts exactly the known codes (property)', () => {
    fc.assert(
      fc.property(fc.string(), (candidate) => {
        expect(isRoleCode(candidate)).toBe((ROLE_CODES as readonly string[]).includes(candidate));
      }),
    );
    for (const code of ROLE_CODES) expect(isRoleCode(code)).toBe(true);
  });
});

describe('isStoreInScope (foundation for P1 scope isolation)', () => {
  it('a store is in scope exactly when the scope names it, its region, or is global', () => {
    fc.assert(
      fc.property(scopeArb, storeArb, (scope, store) => {
        const expected =
          scope.type === 'global' ||
          (scope.type === 'region' && scope.regionIds.includes(store.regionId)) ||
          (scope.type === 'store' && scope.storeIds.includes(store.id));
        expect(isStoreInScope(scope, store)).toBe(expected);
      }),
    );
  });

  it('never grants store-wide access to a self (staff) scope (P11)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), storeArb, (staffId, store) => {
        expect(isStoreInScope({ type: 'self', staffId }, store)).toBe(false);
      }),
    );
  });

  it('filtering by scope only ever returns in-scope stores', () => {
    fc.assert(
      fc.property(scopeArb, fc.array(storeArb, { maxLength: 20 }), (scope, stores) => {
        const visible = stores.filter((s) => isStoreInScope(scope, s));
        for (const s of visible) expect(isStoreInScope(scope, s)).toBe(true);
        expect(visible.length).toBeLessThanOrEqual(stores.length);
      }),
    );
  });
});
