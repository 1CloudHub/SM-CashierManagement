/**
 * Offer terms (task 17; Req 13.1, 13.6; Q23): the cashier's pay for an open
 * shift and the flat transport allowance by travel band, from the published
 * cost rules of the shift's provenance (the documented demo defaults when
 * none is published).
 *
 * Pay is the cashier's own earnings for the shift — the `@lanewise/domain`
 * cost model (paid hours × wage × PH day-type / night / overtime premiums)
 * without the employer on-cost loading. Who may see it is decided by the
 * task 21 cost policy where it is returned (the offered cashier always sees
 * their own offer's pay; managers through `costFigure`).
 */
import { DEMO_PREMIUM_RULES, DEMO_WAGE_RULES, costShift, type PremiumRuleVersion, type WageRuleVersion } from '@lanewise/domain';
import { DEFAULT_TRANSPORT_ALLOWANCE_BANDS, readAllowanceBands, shiftLocalTimes, type AllowanceBand } from '@lanewise/shared';
import type { Queryable } from '../db/pool.js';
import { queryMaybe } from '../db/rows.js';
import type { StoredShift } from '../rosters/overrides.js';

/** Phase 1 stores are all in Metro Manila: the NCR wage order applies. */
export const OFFER_WAGE_REGION = 'NCR';

async function publishedPayload(db: Queryable, ruleSetType: string, synthetic: boolean): Promise<{ id: string; effectiveFrom: string; payload: unknown } | null> {
  const row = await queryMaybe<{ id: string; effective_from: string; payload: unknown }>(
    db,
    `SELECT v.id, v.effective_from, v.payload FROM rule_version v JOIN rule_set rs ON rs.id = v.rule_set_id
      WHERE rs.rule_set_type = $1 AND v.synthetic = $2 AND v.status = 'published'
      ORDER BY v.effective_from DESC, v.version DESC LIMIT 1`,
    [ruleSetType, synthetic],
  );
  return row ? { id: row.id, effectiveFrom: row.effective_from, payload: row.payload } : null;
}

/** Transport allowance bands: the published `transport_allowance` rule, else the demo bands. */
export async function allowanceBands(db: Queryable, synthetic: boolean): Promise<readonly AllowanceBand[]> {
  const rule = await publishedPayload(db, 'transport_allowance', synthetic);
  return (rule && readAllowanceBands(rule.payload)) ?? DEFAULT_TRANSPORT_ALLOWANCE_BANDS;
}

export interface PayRules {
  readonly wage: WageRuleVersion;
  readonly premium: PremiumRuleVersion;
}

const merge = <T extends { id: string; effectiveFrom: string }>(base: T, rule: { id: string; effectiveFrom: string; payload: unknown } | null): T =>
  rule && typeof rule.payload === 'object' && rule.payload !== null
    ? ({ ...base, ...(rule.payload as Partial<T>), id: rule.id, effectiveFrom: rule.effectiveFrom } as T)
    : base;

export async function payRules(db: Queryable, synthetic: boolean): Promise<PayRules> {
  const [wage, premium] = await Promise.all([publishedPayload(db, 'wages', synthetic), publishedPayload(db, 'premiums', synthetic)]);
  return { wage: merge(DEMO_WAGE_RULES, wage), premium: merge(DEMO_PREMIUM_RULES, premium) };
}

/** The cashier's pay (₱, 2 dp) for a shift: hours on the local clock, the meal unpaid, no employer loading. */
export function shiftPay(shift: Pick<StoredShift, 'id' | 'startsAt' | 'endsAt' | 'activities'>, rules: PayRules): number {
  const t = shiftLocalTimes(shift.startsAt, shift.endsAt);
  const meal = shift.activities.find((a) => a.kind === 'meal');
  const cost = costShift(
    {
      id: shift.id,
      departmentId: '',
      date: t.date,
      type: 'FT',
      start: Math.floor(t.startMin / 60),
      end: Math.ceil(t.endMin / 60),
      mealHour: meal ? Math.floor(meal.startMin / 60) : null,
      paidHours: 0,
    },
    OFFER_WAGE_REGION,
    { wage: { ...rules.wage, employerLoading: 0 }, premium: rules.premium },
  );
  return Math.round(cost.cost * 100) / 100;
}
