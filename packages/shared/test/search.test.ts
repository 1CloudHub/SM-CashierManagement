import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ROLE_CODES,
  SEARCH_GROUPS,
  SEARCH_GROUP_RESOURCES,
  can,
  searchableGroups,
  seesPublishedScenariosOnly,
} from '../src/index.js';

describe('searchable groups follow the RBAC matrix', () => {
  it('a group is searchable exactly when the role can view one of its resources', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ROLE_CODES), (role) => {
        const groups = searchableGroups(role);
        for (const g of SEARCH_GROUPS) {
          expect(groups.includes(g)).toBe(SEARCH_GROUP_RESOURCES[g].some((r) => can(role, r, 'view')));
        }
      }),
    );
  });

  it('Staff can search no store-wide group and no other staff (P11); no role gets nothing when null', () => {
    expect(searchableGroups('STF')).toEqual([]);
    expect(searchableGroups(null)).toEqual([]);
    expect(searchableGroups('PLN')).toEqual(['stores', 'departments', 'scenarios', 'staff']);
  });

  it('only the Store Manager is limited to Published scenarios', () => {
    expect(ROLE_CODES.filter(seesPublishedScenariosOnly)).toEqual(['STM']);
  });
});
