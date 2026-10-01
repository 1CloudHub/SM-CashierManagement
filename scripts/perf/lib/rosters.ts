/**
 * Published rosters for the benchmark (the demo seed has none): every demo
 * department gets the four weeks 2026-11-30 … 2026-12-27, shifts planned by
 * the domain engine. Cashiers are assigned with a fast deterministic
 * rotation (one shift a day, never on their preferred rest day; shifts left
 * over stay open) rather than `assignRoster`, which takes ~20 s for this
 * volume (see README) — the read benchmarks only need realistic row counts. In each store the departments alternate between
 * four weekly rosters and one 4-week roster, so both read shapes exist
 * without overlapping published periods.
 */
import { addDays, dateRange, dayOfWeek, planDepartmentDay, type Shift } from '@lanewise/domain';
import { localToInstant } from '@lanewise/shared';
import type pg from 'pg';
import { baseNetwork } from './network.js';

export const ROSTER_FROM = '2026-11-30'; // Monday
export const ROSTER_WEEKS = 4;

export interface SeededRoster {
  readonly id: string;
  readonly storeId: string;
  readonly departmentId: string;
  readonly from: string;
  readonly to: string;
  readonly shifts: number;
}

export async function seedRosters(pool: pg.Pool): Promise<SeededRoster[]> {
  const { ctx, data } = baseNetwork();
  const to = addDays(ROSTER_FROM, ROSTER_WEEKS * 7 - 1);
  const dates = dateRange(ROSTER_FROM, to);
  const out: SeededRoster[] = [];
  for (const store of data.stores) {
    const depts = data.departments.filter((d) => d.storeId === store.id).sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const [i, dept] of depts.entries()) {
      const staff = data.staff.filter((s) => s.departmentId === dept.id).sort((a, b) => (a.id < b.id ? -1 : 1));
      const rows: { s: Shift; staffId: string | null }[] = [];
      for (const [di, date] of dates.entries()) {
        const dow = dayOfWeek(date);
        const free = staff.filter((p) => p.preferredRestDay !== dow);
        const shifts = planDepartmentDay(ctx, dept.domainId, date).shifts;
        shifts.forEach((sh, k) => rows.push({ s: sh, staffId: k < free.length ? free[(k + di) % free.length]!.id : null }));
      }
      const periods = i % 2 === 0 ? Array.from({ length: ROSTER_WEEKS }, (_, w) => [addDays(ROSTER_FROM, w * 7), addDays(ROSTER_FROM, w * 7 + 6)] as const) : [[ROSTER_FROM, to] as const];
      for (const [pFrom, pTo] of periods) {
        const { rows: ins } = await pool.query<{ id: string }>(
          `INSERT INTO roster (store_id, department_id, period_start, period_end, status, published_at, synthetic)
           VALUES ($1, $2, $3, $4, 'published', now(), true) RETURNING id`,
          [store.id, dept.id, pFrom, pTo],
        );
        const rosterId = ins[0]!.id;
        const mine = rows.filter((x) => x.s.date >= pFrom && x.s.date <= pTo);
        await pool.query(
          `INSERT INTO shift (roster_id, staff_id, department_id, starts_at, ends_at, synthetic)
           SELECT $1, u.staff_id, $2, u.starts_at, u.ends_at, true
             FROM unnest($3::uuid[], $4::timestamptz[], $5::timestamptz[]) AS u(staff_id, starts_at, ends_at)`,
          [
            rosterId,
            dept.id,
            mine.map((x) => x.staffId),
            mine.map((x) => localToInstant(x.s.date, x.s.start * 60)),
            mine.map((x) => localToInstant(x.s.date, x.s.end * 60)),
          ],
        );
        out.push({ id: rosterId, storeId: store.id, departmentId: dept.id, from: pFrom, to: pTo, shifts: mine.length });
      }
    }
  }
  await pool.query('ANALYZE');
  return out;
}
