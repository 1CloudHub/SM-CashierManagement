/**
 * Rule sets and versions (Req 16; P6, P7): payload schemas the domain engine
 * consumes, the version lifecycle, the Finance gate on cost rules, per-route
 * permissions and the version diff.
 */
import { isDeepStrictEqual } from 'node:util';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  COST_RULE_SET_TYPES,
  ROLE_CODES,
  RULE_PERMISSIONS,
  RULE_PERMISSION_GRANTS,
  RULE_PERMISSION_KEYS,
  can,
  hasRulePermission,
  RULE_SET_TYPES,
  RULE_VERSION_ACTIONS,
  RULE_VERSION_STATUSES,
  applyRulePayloadChanges,
  canPublishRuleVersion,
  diffRulePayloads,
  isCostRuleSetType,
  isRuleVersionEditable,
  ruleVersionTransition,
  validateRulePayload,
  type RuleSetType,
  type RuleVersionStatus,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Arbitraries for valid payloads of every rule-set type.
// ---------------------------------------------------------------------------
const pos = (max = 10_000): fc.Arbitrary<number> =>
  fc.double({ min: 0.01, max, noNaN: true, noDefaultInfinity: true });
const frac: fc.Arbitrary<number> = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });
const byContract = <T>(arb: fc.Arbitrary<T>) => fc.record({ FT: arb, PT: arb, FLOAT: arb });
const isoDate = fc
  .date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2035-12-31T00:00:00Z'), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));

const serviceLevels = fc
  .record({
    serviceLevel: fc.double({ min: 0.5, max: 0.99, noNaN: true }),
    thresholdSec: fc.integer({ min: 1, max: 600 }),
    shrinkage: fc.double({ min: 0, max: 1, noNaN: true }),
    ptMin: fc.integer({ min: 1, max: 6 }),
    ptExtra: fc.integer({ min: 0, max: 4 }),
    floatMin: fc.integer({ min: 1, max: 8 }),
    floatExtra: fc.integer({ min: 0, max: 4 }),
  })
  .map((r) => ({
    serviceTarget: { serviceLevel: r.serviceLevel, thresholdSec: r.thresholdSec },
    shrinkage: r.shrinkage,
    shifts: {
      ftSpanHours: 9,
      ftMealHours: 1,
      mealWindow: { earliestOffset: 4, latestOffset: 6 },
      ftMinUsefulHours: 9,
      reliefMinUsefulHours: 2,
      ptMinHours: r.ptMin,
      ptMaxHours: r.ptMin + r.ptExtra,
      ptMinUsefulHours: 1,
      floatMinHours: r.floatMin,
      floatMaxHours: r.floatMin + r.floatExtra,
      floatMinUsefulHours: 1,
    },
  }));

const labor = fc
  .record({
    maxConsecutiveDays: fc.integer({ min: 1, max: 13 }),
    restAfterConsecutiveDays: fc.integer({ min: 1, max: 13 }),
    mandatoryRestHours: fc.integer({ min: 1, max: 72 }),
    minRestBetweenShiftsHours: fc.integer({ min: 0, max: 24 }),
    maxWeeklyHours: byContract(fc.integer({ min: 1, max: 84 })),
  });

const wages = fc.record({
  hourlyRateByRegion: fc.dictionary(fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim() === s && s.length > 0), pos(1000), {
    minKeys: 1,
    maxKeys: 6,
  }),
  defaultHourlyRate: pos(1000),
  employerLoading: frac,
});

const premiums = fc
  .record({
    special: fc.double({ min: 1, max: 4, noNaN: true }),
    regularHoliday: fc.double({ min: 1, max: 4, noNaN: true }),
    nightDifferential: frac,
    nightStartHour: fc.integer({ min: 18, max: 23 }),
    nightEndHour: fc.integer({ min: 0, max: 8 }),
    overtimeMultiplier: fc.double({ min: 1, max: 3, noNaN: true }),
    regularHoursPerShift: fc.integer({ min: 1, max: 12 }),
  })
  .map(({ special, regularHoliday, ...rest }) => ({
    dayTypeMultiplier: { regular: 1, special, regularHoliday },
    ...rest,
  }));

const leadTimes = fc
  .record({
    lead: byContract(fc.integer({ min: 0, max: 120 })),
    weekly: byContract(fc.integer({ min: 1, max: 60 })),
    buffer: frac,
    names: fc.uniqueArray(fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0), { minLength: 1, maxLength: 5 }),
  })
  .map(({ lead, weekly, buffer, names }) => ({
    leadTimeDays: lead,
    contractWeeklyHours: weekly,
    recruitingBuffer: buffer,
    // Milestones ordered largest first, the last at the need-by date.
    milestones: names.map((name, i) => {
      const k = names.length - 1 - i;
      return { name, daysBeforeNeedBy: { FT: k * 3, PT: k * 2, FLOAT: k } };
    }),
  }));

const holidays = fc
  .uniqueArray(
    fc.record({
      date: isoDate,
      name: fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
      dayType: fc.constantFrom('special' as const, 'regularHoliday' as const),
    }),
    { selector: (h) => h.date, maxLength: 20 },
  )
  .map((list) => ({ holidays: list }));

const transport = fc
  .uniqueArray(fc.integer({ min: 1, max: 240 }), { minLength: 1, maxLength: 6 })
  .chain((mins) =>
    fc
      .array(fc.integer({ min: 0, max: 1000 }), { minLength: mins.length, maxLength: mins.length })
      .map((amounts) => ({
        bands: [...mins].sort((a, b) => a - b).map((maxTravelMin, i) => ({ maxTravelMin, allowancePhp: amounts[i] ?? 0 })),
      })),
  );

const VALID: Record<RuleSetType, fc.Arbitrary<Record<string, unknown>>> = {
  service_levels: serviceLevels,
  labor,
  wages,
  premiums,
  lead_times: leadTimes,
  holidays,
  transport_allowance: transport,
};

const typedPayload = fc
  .constantFrom(...RULE_SET_TYPES)
  .chain((type) => VALID[type].map((payload) => ({ type, payload })));

/** Every leaf path of a JSON value. */
function leaves(value: unknown, path: (string | number)[] = []): (string | number)[][] {
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, [...path, i]));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => leaves(v, [...path, k]));
  }
  return [path];
}

function setAt(value: unknown, path: readonly (string | number)[], leaf: unknown): unknown {
  if (path.length === 0) return leaf;
  const [head, ...rest] = path as [string | number, ...(string | number)[]];
  if (Array.isArray(value)) return value.map((v, i) => (i === head ? setAt(v, rest, leaf) : v));
  const obj = value as Record<string, unknown>;
  return { ...obj, [head]: setAt(obj[head], rest, leaf) };
}

// Demo versions the engine ships with (packages/domain/src/rules.ts DEMO_*),
// minus id/effectiveFrom which live on the rule version row.
const DOMAIN_DEMO: Record<RuleSetType, Record<string, unknown>> = {
  service_levels: {
    serviceTarget: { serviceLevel: 0.9, thresholdSec: 60 },
    shrinkage: 0.17,
    shifts: {
      ftSpanHours: 9,
      ftMealHours: 1,
      mealWindow: { earliestOffset: 4, latestOffset: 6 },
      ftMinUsefulHours: 9,
      reliefMinUsefulHours: 2,
      ptMinHours: 4,
      ptMaxHours: 4,
      ptMinUsefulHours: 1,
      floatMinHours: 8,
      floatMaxHours: 8,
      floatMinUsefulHours: 7,
    },
  },
  labor: {
    maxConsecutiveDays: 6,
    restAfterConsecutiveDays: 6,
    mandatoryRestHours: 24,
    minRestBetweenShiftsHours: 10,
    maxWeeklyHours: { FT: 48, PT: 30, FLOAT: 40 },
  },
  wages: {
    hourlyRateByRegion: { NCR: 86.875, 'Central Luzon': 68.75, 'Central Visayas': 67.5 },
    defaultHourlyRate: 80,
    employerLoading: 0.14,
  },
  premiums: {
    dayTypeMultiplier: { regular: 1, special: 1.3, regularHoliday: 2 },
    nightDifferential: 0.1,
    nightStartHour: 22,
    nightEndHour: 6,
    overtimeMultiplier: 1.25,
    regularHoursPerShift: 8,
  },
  lead_times: {
    leadTimeDays: { FT: 42, PT: 28, FLOAT: 21 },
    contractWeeklyHours: { FT: 48, PT: 24, FLOAT: 32 },
    recruitingBuffer: 0.1,
    milestones: [
      { name: 'Requisition approved', daysBeforeNeedBy: { FT: 42, PT: 28, FLOAT: 21 } },
      { name: 'Start on the floor', daysBeforeNeedBy: { FT: 0, PT: 0, FLOAT: 0 } },
    ],
  },
  holidays: { holidays: [{ date: '2026-12-25', name: 'Christmas Day', dayType: 'regularHoliday' }] },
  transport_allowance: { bands: [{ maxTravelMin: 30, allowancePhp: 0 }, { maxTravelMin: 60, allowancePhp: 100 }] },
};

// ---------------------------------------------------------------------------

describe('rule payload validation (the schema the engine consumes)', () => {
  it('accepts the engine demo versions for every rule-set type', () => {
    for (const type of RULE_SET_TYPES) {
      const result = validateRulePayload(type, DOMAIN_DEMO[type]);
      expect(result, type).toEqual({ ok: true, value: DOMAIN_DEMO[type] });
    }
  });

  it('accepts every well-formed payload unchanged', () => {
    fc.assert(
      fc.property(typedPayload, ({ type, payload }) => {
        const result = validateRulePayload(type, payload);
        expect(result.ok ? result.value : result.issues).toEqual(payload);
      }),
    );
  });

  it('rejects a leaf of the wrong JSON type and reports its path', () => {
    fc.assert(
      fc.property(typedPayload, fc.nat(), ({ type, payload }, i) => {
        const paths = leaves(payload);
        const path = paths[i % paths.length] ?? [];
        fc.pre(path.length > 0);
        const original = path.reduce<unknown>((v, k) => (v as Record<string | number, unknown>)[k], payload);
        const wrong = typeof original === 'number' ? 'x' : 42;
        const result = validateRulePayload(type, setAt(payload, path, wrong));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.issues.map((x) => x.path)).toContain(path.join('.'));
      }),
    );
  });

  it('rejects unknown and missing top-level fields', () => {
    fc.assert(
      fc.property(typedPayload, fc.nat(), ({ type, payload }, i) => {
        const extra = validateRulePayload(type, { ...payload, unexpectedField: 1 });
        expect(extra.ok).toBe(false);
        if (!extra.ok) expect(extra.issues.map((x) => x.path)).toContain('unexpectedField');

        const keys = Object.keys(payload);
        const drop = keys[i % keys.length] as string;
        const rest = Object.fromEntries(Object.entries(payload).filter(([k]) => k !== drop));
        const missing = validateRulePayload(type, rest);
        expect(missing.ok).toBe(false);
        if (!missing.ok) expect(missing.issues.map((x) => x.path)).toContain(drop);
      }),
    );
  });

  it('accepts the engine identity fields a version may carry (as the demo seed stores them)', () => {
    fc.assert(
      fc.property(typedPayload, isoDate, ({ type, payload }, effectiveFrom) => {
        const withIdentity = { id: `${type}-demo-2026.1`, effectiveFrom, ...payload };
        expect(validateRulePayload(type, withIdentity).ok).toBe(true);
        expect(validateRulePayload(type, { ...withIdentity, effectiveFrom: '2026-13-01' }).ok).toBe(false);
      }),
    );
    expect(
      validateRulePayload('holidays', {
        calendarYear: 2026,
        holidays: [{ date: '2026-12-25', id: 'christmas-day', name: 'Christmas Day', dayType: 'regularHoliday' }],
      }).ok,
    ).toBe(true);
  });

  it('rejects non-object payloads and out-of-range values', () => {
    for (const type of RULE_SET_TYPES) {
      expect(validateRulePayload(type, null).ok).toBe(false);
      expect(validateRulePayload(type, [1]).ok).toBe(false);
    }
    const w = validateRulePayload('wages', { hourlyRateByRegion: { NCR: -1 }, defaultHourlyRate: 0, employerLoading: 2 });
    expect(w.ok).toBe(false);
    if (!w.ok) {
      expect(w.issues.map((x) => x.path).sort()).toEqual(['defaultHourlyRate', 'employerLoading', 'hourlyRateByRegion.NCR']);
    }
  });

  it('checks cross-field consistency', () => {
    const sl = DOMAIN_DEMO.service_levels as { shifts: Record<string, unknown> };
    const badShift = validateRulePayload('service_levels', {
      ...DOMAIN_DEMO.service_levels,
      shifts: { ...sl.shifts, ptMinHours: 6, ptMaxHours: 4 },
    });
    expect(badShift.ok).toBe(false);

    const dupHoliday = validateRulePayload('holidays', {
      holidays: [
        { date: '2026-12-25', name: 'Christmas Day', dayType: 'regularHoliday' },
        { date: '2026-12-25', name: 'Again', dayType: 'special' },
      ],
    });
    expect(dupHoliday.ok).toBe(false);

    const unsortedBands = validateRulePayload('transport_allowance', {
      bands: [{ maxTravelMin: 60, allowancePhp: 100 }, { maxTravelMin: 30, allowancePhp: 0 }],
    });
    expect(unsortedBands.ok).toBe(false);

    const badDate = validateRulePayload('holidays', {
      holidays: [{ date: '2026-02-30', name: 'Nope', dayType: 'special' }],
    });
    expect(badDate.ok).toBe(false);
  });
});

describe('cost rules (Req 16.3, 16.4)', () => {
  it('wages, premiums and transport allowance are cost rules; the rest are not', () => {
    for (const type of RULE_SET_TYPES) {
      expect(isCostRuleSetType(type)).toBe((COST_RULE_SET_TYPES as readonly string[]).includes(type));
    }
    expect([...COST_RULE_SET_TYPES].sort()).toEqual(['premiums', 'transport_allowance', 'wages']);
  });
});

describe('rule version lifecycle', () => {
  const statusArb = fc.constantFrom(...RULE_VERSION_STATUSES);
  const actionArb = fc.constantFrom(...RULE_VERSION_ACTIONS);

  it('a cost rule is published only after Finance approval; a non-cost rule never needs it', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.array(actionArb, { maxLength: 15 }), (isCost, actions) => {
        let status: RuleVersionStatus = 'draft';
        const visited: RuleVersionStatus[] = [status];
        for (const action of actions) {
          const next = ruleVersionTransition(status, isCost, action);
          if (next !== null) {
            status = next;
            visited.push(status);
          }
        }
        const published = visited.indexOf('published');
        if (isCost && published >= 0) expect(visited[published - 1]).toBe('approved');
        if (!isCost) expect(visited).not.toContain('approved');
        if (!isCost) expect(visited).not.toContain('changes_requested');
      }),
    );
  });

  it('only draft and changes-requested versions are editable, and published ones are final', () => {
    fc.assert(
      fc.property(statusArb, fc.boolean(), actionArb, (status, isCost, action) => {
        expect(isRuleVersionEditable(status)).toBe(status === 'draft' || status === 'changes_requested');
        if (action === 'edit') expect(ruleVersionTransition(status, isCost, action) !== null).toBe(isRuleVersionEditable(status));
        if (status === 'published' || status === 'superseded') {
          expect(ruleVersionTransition(status, isCost, action)).toBeNull();
        }
      }),
    );
  });

  it('publishing: Finance publishes approved cost rules; the Rules Steward publishes non-cost rules', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ROLE_CODES), fc.boolean(), statusArb, (role, isCost, status) => {
        const allowed = canPublishRuleVersion(role, isCost, status);
        if (allowed && isCost) expect([role, status]).toEqual(['FIN', 'approved']);
        if (allowed && !isCost) expect(role).toBe('RST');
        if (role === 'RST' && !isCost) expect(allowed).toBe(status === 'draft' || status === 'submitted');
        if (role === 'FIN' && isCost) expect(allowed).toBe(status === 'approved');
      }),
    );
  });

  it('derives rule permissions from the design RBAC matrix', () => {
    expect(RULE_PERMISSIONS['rules.edit']).toEqual(['RST']);
    expect(RULE_PERMISSIONS['rules.approve_cost']).toEqual(['FIN']);
    expect(RULE_PERMISSIONS['rules.publish_cost']).toEqual(['FIN']);
    expect(RULE_PERMISSIONS['rules.publish_noncost']).toEqual(['RST']);
    expect([...RULE_PERMISSIONS['rules.view']].sort()).toEqual(['EXE', 'FIN', 'HR', 'PLN', 'RST']);
    for (const key of RULE_PERMISSION_KEYS) {
      for (const role of ROLE_CODES) {
        const { resource, action } = RULE_PERMISSION_GRANTS[key];
        expect(hasRulePermission(role, key)).toBe(can(role, resource, action));
      }
    }
  });
});

describe('rule version diff', () => {
  it('is empty exactly when the payloads are equal, and reconstructs the new payload', () => {
    fc.assert(
      fc.property(typedPayload, typedPayload, ({ payload: a }, { payload: b }) => {
        expect(diffRulePayloads(a, a)).toEqual([]);
        const changes = diffRulePayloads(a, b);
        expect(changes.length === 0).toBe(isDeepStrictEqual(a, b));
        expect(applyRulePayloadChanges(a, changes)).toEqual(b);
      }),
    );
  });

  it('reports leaf paths with before and after values', () => {
    expect(
      diffRulePayloads(
        { hourlyRateByRegion: { NCR: 86.875 }, defaultHourlyRate: 80 },
        { hourlyRateByRegion: { NCR: 90, Visayas: 70 }, defaultHourlyRate: 80 },
      ),
    ).toEqual([
      { path: ['hourlyRateByRegion', 'NCR'], kind: 'changed', before: 86.875, after: 90 },
      { path: ['hourlyRateByRegion', 'Visayas'], kind: 'added', after: 70 },
    ]);
  });
});
