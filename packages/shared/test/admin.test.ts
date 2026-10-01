import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_EVENT_CATEGORIES,
  ALLOWED_EMAIL_DOMAINS,
  RBAC_MATRIX,
  ROLE_CODES,
  auditCategoriesFor,
  auditChanges,
  auditEventCategory,
  checkInviteEmail,
  isIsoDate,
  isUserInAdminScope,
  permissionLetters,
  scopeContains,
  scopeFromAdminInput,
  sortRoles,
  type Scope,
} from '../src/index.js';

// A small fixed network: 3 regions × 3 stores, one staff record per store.
const REGIONS = ['r1', 'r2', 'r3'];
const STORES = REGIONS.flatMap((r) => [1, 2, 3].map((n) => ({ id: `${r}-s${n}`, regionId: r })));
const storeRegion = (id: string) => STORES.find((s) => s.id === id)?.regionId;
const staffStore = (id: string) => (id.startsWith('staff-') ? id.slice('staff-'.length) : undefined);

const subset = <T>(xs: readonly T[]) => fc.subarray([...xs], { minLength: 1 });
const scopeArb: fc.Arbitrary<Scope> = fc.oneof(
  fc.constant<Scope>({ type: 'global' }),
  subset(REGIONS).map((regionIds): Scope => ({ type: 'region', regionIds })),
  subset(STORES.map((s) => s.id)).map((storeIds): Scope => ({ type: 'store', storeIds })),
  fc.constantFrom(...STORES.map((s) => s.id)).map((id): Scope => ({ type: 'self', staffId: `staff-${id}` })),
);

/** Every store a scope grants (self: the staff record's store). */
function storesOf(scope: Scope): Set<string> {
  switch (scope.type) {
    case 'global':
      return new Set(STORES.map((s) => s.id));
    case 'region':
      return new Set(STORES.filter((s) => scope.regionIds.includes(s.regionId)).map((s) => s.id));
    case 'store':
      return new Set(scope.storeIds);
    case 'self': {
      const store = staffStore(scope.staffId);
      return new Set(store ? [store] : []);
    }
  }
}

describe('P1: an administrator only sees and grants access inside their own scope', () => {
  it('scopeContains never lets a scoped administrator reach a store outside their scope', () => {
    fc.assert(
      fc.property(scopeArb, scopeArb, (outer, inner) => {
        if (outer.type === 'self') return;
        if (!scopeContains(outer, inner, storeRegion, staffStore)) return;
        const allowed = storesOf(outer);
        for (const store of storesOf(inner)) expect(allowed.has(store)).toBe(true);
        // A non-global administrator never grants network-wide access.
        if (outer.type !== 'global') expect(inner.type).not.toBe('global');
      }),
    );
  });

  it('a global administrator contains every scope; containment is reflexive', () => {
    fc.assert(
      fc.property(scopeArb, (scope) => {
        expect(scopeContains({ type: 'global' }, scope, storeRegion, staffStore)).toBe(true);
        expect(scopeContains(scope, scope, storeRegion, staffStore)).toBe(true);
      }),
    );
  });

  it('a region administrator contains exactly the stores of their regions', () => {
    fc.assert(
      fc.property(subset(REGIONS), subset(STORES.map((s) => s.id)), (regionIds, storeIds) => {
        const inside = storeIds.every((id) => regionIds.includes(storeRegion(id) ?? ''));
        expect(scopeContains({ type: 'region', regionIds }, { type: 'store', storeIds }, storeRegion)).toBe(inside);
      }),
    );
  });

  it('unknown stores are never contained', () => {
    expect(scopeContains({ type: 'region', regionIds: REGIONS }, { type: 'store', storeIds: ['nope'] }, storeRegion)).toBe(false);
  });

  it('a user is visible only when every assignment is inside the administrator scope', () => {
    fc.assert(
      fc.property(scopeArb, fc.array(scopeArb, { maxLength: 4 }), (admin, scopes) => {
        const assignments = scopes.map((scope) => ({ scope }));
        const visible = isUserInAdminScope(admin, assignments, storeRegion, staffStore);
        if (admin.type === 'global') expect(visible).toBe(true);
        else if (visible) {
          expect(assignments.length).toBeGreaterThan(0);
          const allowed = storesOf(admin);
          for (const a of assignments) for (const s of storesOf(a.scope)) expect(allowed.has(s)).toBe(true);
        }
      }),
    );
  });
});

describe('P13: SCR-071 refuses any email outside the allowlist', () => {
  const local = fc.stringMatching(/^[a-z0-9][a-z0-9._-]{0,20}[a-z0-9]$/).filter((s) => !s.includes('..'));

  it('accepts allowlisted work emails (normalised)', () => {
    fc.assert(
      fc.property(local, fc.constantFrom(...ALLOWED_EMAIL_DOMAINS), fc.boolean(), (l, d, upper) => {
        const typed = ` ${upper ? `${l}@${d}`.toUpperCase() : `${l}@${d}`} `;
        expect(checkInviteEmail(typed)).toEqual({ ok: true, email: `${l}@${d}` });
      }),
    );
  });

  it('rejects every other domain, including look-alikes and subdomains', () => {
    const other = fc.oneof(
      fc.domain().filter((d) => !(ALLOWED_EMAIL_DOMAINS as readonly string[]).includes(d.toLowerCase())),
      fc.constantFrom('it.smretail.com', 'smretail.com.evil.io', 'evilsmretail.com', '1cloudhub.co', 'smretaıl.com'),
    );
    fc.assert(
      fc.property(local, other, (l, d) => {
        expect(checkInviteEmail(`${l}@${d}`)).toEqual({ ok: false, problem: 'domain_not_allowed' });
      }),
    );
  });

  it('asks for an email when blank', () => {
    expect(checkInviteEmail('   ')).toEqual({ ok: false, problem: 'required' });
  });
});

describe('admin helpers', () => {
  it('sorts roles in matrix order and drops duplicates', () => {
    expect(sortRoles(['STF', 'ADM', 'PLN', 'ADM'])).toEqual(['ADM', 'PLN', 'STF']);
  });

  it('dedupes scope ids', () => {
    expect(scopeFromAdminInput({ type: 'store', storeIds: ['a', 'a', 'b'] })).toEqual({ type: 'store', storeIds: ['a', 'b'] });
  });

  it('renders matrix cells as design.md letters', () => {
    expect(permissionLetters(RBAC_MATRIX.audit_log.ADM ?? null)).toBe('V X');
    expect(permissionLetters(RBAC_MATRIX.users_roles.ADM ?? null)).toBe('M');
    expect(permissionLetters(RBAC_MATRIX.users_roles.EXE ?? null)).toBeNull();
  });

  it('categorises events by their object prefix; exports by action', () => {
    expect(auditEventCategory({ event: 'scenario.submitted', action: 'submit' })).toBe('scenario');
    expect(auditEventCategory({ event: 'approval.plan_approved', action: 'decision' })).toBe('scenario');
    expect(auditEventCategory({ event: 'rule_version.published', action: 'publish' })).toBe('rules');
    expect(auditEventCategory({ event: 'dataset.loaded', action: 'ingestion' })).toBe('data');
    expect(auditEventCategory({ event: 'role.granted', action: 'role_change' })).toBe('user');
    expect(auditEventCategory({ event: 'export.generated', action: 'export' })).toBe('export');
    expect(auditEventCategory({ event: 'saved_view.created', action: 'create' })).toBe('other');
  });

  it('limits the Rules Steward to data and rules events; only ADM and RST read the log', () => {
    expect(auditCategoriesFor('RST')).toEqual(['data', 'rules']);
    expect(auditCategoriesFor('ADM')).toEqual(AUDIT_EVENT_CATEGORIES);
    for (const role of ROLE_CODES.filter((r) => r !== 'ADM' && r !== 'RST')) expect(auditCategoriesFor(role)).toBeNull();
    expect(auditCategoriesFor(null)).toBeNull();
  });

  it('lists only the changed fields of an event', () => {
    expect(auditChanges({ a: 1, b: 'x', c: [1] }, { a: 2, b: 'x', d: true })).toEqual([
      { field: 'a', before: '1', after: '2' },
      { field: 'c', before: '[1]', after: null },
      { field: 'd', before: null, after: 'true' },
    ]);
    expect(auditChanges(null, null)).toEqual([]);
  });

  it('validates calendar dates (shared with rules)', () => {
    expect(isIsoDate('2026-10-01')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-1-1')).toBe(false);
  });
});
