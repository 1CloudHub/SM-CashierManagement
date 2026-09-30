import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  NAV_ITEMS,
  PERMISSION_ACTIONS,
  RBAC_MATRIX,
  RBAC_RESOURCES,
  RBAC_RESOURCE_LABELS,
  ROLE_CODES,
  can,
  effectivePermissions,
  permissionFor,
  resolveActiveRole,
  selectableRoles,
  visibleNav,
  type PermissionAction,
  type RoleAssignment,
  type RoleCode,
} from '../src/index.js';

const roleArb = fc.constantFrom(...ROLE_CODES);
const resourceArb = fc.constantFrom(...RBAC_RESOURCES);
const actionArb = fc.constantFrom(...PERMISSION_ACTIONS);

const LETTER_TO_ACTION: Readonly<Record<string, PermissionAction>> = {
  V: 'view',
  E: 'edit',
  A: 'approve',
  X: 'export',
  M: 'manage',
};

interface ParsedCell {
  readonly actions: readonly PermissionAction[];
  readonly qualified: boolean;
}

/** Reads the RBAC matrix table out of design.md (the source of truth). */
function parseDesignMatrix(): Map<string, Map<RoleCode, ParsedCell>> {
  const designPath = fileURLToPath(
    new URL('../../../.kiro/specs/cashier-staffing-planner/design.md', import.meta.url),
  );
  const lines = readFileSync(designPath, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.startsWith('| Capability | ADM |'));
  expect(start).toBeGreaterThan(0);
  const rows = new Map<string, Map<RoleCode, ParsedCell>>();
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    const label = cells[0] as string;
    const byRole = new Map<RoleCode, ParsedCell>();
    ROLE_CODES.forEach((role, i) => {
      const cell = cells[i + 1] as string;
      const head = cell.split('(')[0]?.trim() ?? '';
      const actions = head === '—' ? [] : head.split(/\s+/).map((letter) => {
        const action = LETTER_TO_ACTION[letter];
        if (!action) throw new Error(`unknown RBAC letter "${letter}" in "${label}"`);
        return action;
      });
      byRole.set(role, { actions, qualified: cell.includes('(') });
    });
    rows.set(label, byRole);
  }
  return rows;
}

describe('RBAC matrix data (design.md › RBAC matrix)', () => {
  const design = parseDesignMatrix();

  it('has one resource per design.md capability row, and no extras', () => {
    expect([...design.keys()].sort()).toEqual(Object.values(RBAC_RESOURCE_LABELS).sort());
    expect(Object.keys(RBAC_RESOURCE_LABELS).sort()).toEqual([...RBAC_RESOURCES].sort());
  });

  it('matches every cell of the design.md matrix (actions and qualifiers)', () => {
    for (const resource of RBAC_RESOURCES) {
      const row = design.get(RBAC_RESOURCE_LABELS[resource]);
      expect(row, resource).toBeDefined();
      for (const role of ROLE_CODES) {
        const expected = row?.get(role) as ParsedCell;
        const actual = RBAC_MATRIX[resource][role];
        expect([...(actual?.actions ?? [])].sort(), `${resource}/${role}`).toEqual([...expected.actions].sort());
        expect(actual?.limit !== undefined, `${resource}/${role} qualifier`).toBe(expected.qualified);
      }
    }
  });
});

describe('can()', () => {
  it('grants exactly the listed actions, plus view for any grant and edit for manage', () => {
    fc.assert(
      fc.property(roleArb, resourceArb, actionArb, (role, resource, action) => {
        const listed = permissionFor(role, resource)?.actions ?? [];
        const expected =
          listed.includes(action) ||
          (action === 'view' && listed.length > 0) ||
          (action === 'edit' && listed.includes('manage'));
        expect(can(role, resource, action)).toBe(expected);
      }),
    );
  });

  it('agrees with effectivePermissions()', () => {
    fc.assert(
      fc.property(roleArb, resourceArb, actionArb, (role, resource, action) => {
        const effective = effectivePermissions(role)[resource] ?? [];
        expect(effective.includes(action)).toBe(can(role, resource, action));
      }),
    );
  });

  it('never grants anything to a null (unresolved) role', () => {
    fc.assert(
      fc.property(resourceArb, actionArb, (resource, action) => {
        expect(can(null, resource, action)).toBe(false);
      }),
    );
  });

  it('spot checks: only ADM manages users; only STF sees My roster; STF never sees store-wide screens', () => {
    for (const role of ROLE_CODES) {
      expect(can(role, 'users_roles', 'manage')).toBe(role === 'ADM');
      expect(can(role, 'my_roster', 'view')).toBe(role === 'STF');
    }
    for (const resource of [
      'network_view',
      'department_plan',
      'weekly_roster',
      'master_data',
      'staff_records',
      'cost_figures',
      'hiring_plan',
    ] as const) {
      expect(can('STF', resource, 'view')).toBe(false);
    }
    expect(can('FIN', 'rules_cost_approval', 'approve')).toBe(true);
    expect(can('RST', 'rules_cost_approval', 'approve')).toBe(false);
    expect(can('STM', 'master_data', 'view')).toBe(true);
    expect(can('ADM', 'master_data', 'view')).toBe(false);
  });
});

describe('navigation', () => {
  it('shows a nav item exactly when the role can view one of its resources (hidden, never disabled)', () => {
    fc.assert(
      fc.property(roleArb, (role) => {
        const nav = visibleNav(role);
        for (const item of NAV_ITEMS) {
          expect(nav.includes(item.key)).toBe(item.resources.some((r) => can(role, r, 'view')));
        }
      }),
    );
  });

  it('always shows Home and Profile, and nothing for an unresolved role', () => {
    for (const role of ROLE_CODES) {
      expect(visibleNav(role)).toContain('home');
      expect(visibleNav(role)).toContain('profile');
    }
    expect(visibleNav(null)).toEqual([]);
  });
});

const assignmentsArb: fc.Arbitrary<RoleAssignment[]> = fc
  .uniqueArray(roleArb, { maxLength: 4 })
  .map((roles) =>
    roles.map(
      (role): RoleAssignment => ({
        userId: 'u',
        role,
        scope: role === 'STF' ? { type: 'self', staffId: 's' } : { type: 'global' },
      }),
    ),
  );

describe('resolveActiveRole (demo role switcher, requirement 3)', () => {
  it('only ever resolves to a role the user may select, or rejects', () => {
    fc.assert(
      fc.property(
        fc.option(fc.oneof(roleArb, fc.string({ maxLength: 6 })), { nil: undefined }),
        fc.option(roleArb, { nil: null }),
        assignmentsArb,
        fc.boolean(),
        (header, persisted, assignments, demoMode) => {
          const result = resolveActiveRole({ header, persisted, assignments, demoMode });
          const allowed = selectableRoles(assignments, demoMode);
          if (header !== undefined) {
            if ((allowed as readonly string[]).includes(header)) {
              expect(result).toEqual({ ok: true, role: header });
            } else {
              expect(result).toEqual({ ok: false });
            }
          } else if (result.ok && result.role !== null) {
            expect(allowed).toContain(result.role);
          }
        },
      ),
    );
  });

  it('lets any role be selected in demo mode, only assigned roles otherwise', () => {
    expect(selectableRoles([], true)).toEqual(ROLE_CODES);
    expect(selectableRoles([], false)).toEqual([]);
    expect(resolveActiveRole({ header: 'EXE', persisted: null, assignments: [], demoMode: true })).toEqual({
      ok: true,
      role: 'EXE',
    });
    expect(resolveActiveRole({ header: 'EXE', persisted: null, assignments: [], demoMode: false })).toEqual({
      ok: false,
    });
  });

  it('falls back to the persisted role, then the first assigned role, then none', () => {
    const planner: RoleAssignment = { userId: 'u', role: 'PLN', scope: { type: 'global' } };
    const hr: RoleAssignment = { userId: 'u', role: 'HR', scope: { type: 'global' } };
    expect(resolveActiveRole({ persisted: 'HR', assignments: [planner, hr], demoMode: false })).toEqual({
      ok: true,
      role: 'HR',
    });
    expect(resolveActiveRole({ persisted: 'EXE', assignments: [hr, planner], demoMode: false })).toEqual({
      ok: true,
      role: 'PLN',
    });
    expect(resolveActiveRole({ persisted: null, assignments: [], demoMode: true })).toEqual({ ok: true, role: null });
  });
});
