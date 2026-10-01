/**
 * Where the network map gets each store's staffing gap or surplus (task 16.1).
 *
 * The full picture — the Erlang C requirement per store, department and hour
 * — belongs to the network view (task 14, SCR-020). Until that lands, the map
 * reads the one gap signal already in the data: OPEN (unassigned) shifts on
 * published rosters. That source can report gaps but never a surplus, so
 * store-to-store moves appear only once task 14 backs this interface with a
 * `network_view` source (`required` from the requirement, `surplus` =
 * rostered − required where positive).
 *
 * TODO(task 14): add a `network_view` NetworkGapsSource and make it the default.
 */
import { MAP_DAY_PART_HOURS, type GapsSourceKind, type IsoDate, type MapDayPart } from '@lanewise/shared';
import type { Queryable } from '../db/pool.js';
import { listPublishedShifts, localInstant } from '../db/repositories/network-map.js';

export interface OpenShiftSlot {
  readonly shiftId: string;
  readonly date: IsoDate;
  readonly startHour: number;
  readonly endHour: number;
}

/** One store × department in the window. */
export interface StoreDepartmentGap {
  readonly storeId: string;
  readonly departmentKey: string;
  readonly departmentName: string;
  /** Cashiers needed in the window. */
  readonly required: number;
  /** Distinct cashiers rostered in the window. */
  readonly rostered: number;
  /** Open shifts STARTING in the window (what offers and moves fill). */
  readonly openShifts: readonly OpenShiftSlot[];
  /** Spare cashiers another store could borrow (0 when unknown). */
  readonly surplus: number;
}

export interface NetworkGapsQuery {
  readonly date: IsoDate;
  readonly dayPart: MapDayPart;
  /** In-scope stores only (P1): the caller has already filtered by scope and format. */
  readonly storeIds: readonly string[];
  readonly department?: string;
  readonly synthetic: boolean;
}

export interface NetworkGapsSource {
  readonly kind: GapsSourceKind;
  gaps(db: Queryable, query: NetworkGapsQuery): Promise<StoreDepartmentGap[]>;
}

/** Gaps from open shifts on published rosters; `required` = rostered + open. No surplus. */
export const publishedRosterGaps: NetworkGapsSource = {
  kind: 'published_roster',
  async gaps(db, q) {
    const [startHour, endHour] = MAP_DAY_PART_HOURS[q.dayPart];
    const shifts = await listPublishedShifts(db, {
      storeIds: q.storeIds,
      from: localInstant(q.date, startHour),
      to: localInstant(q.date, endHour),
      synthetic: q.synthetic,
    });
    const groups = new Map<string, { storeId: string; key: string; name: string; staff: Set<string>; open: OpenShiftSlot[]; openOverlapping: number }>();
    for (const s of shifts) {
      if (q.department !== undefined && s.departmentKey !== q.department) continue;
      const k = `${s.storeId}|${s.departmentKey}`;
      const g = groups.get(k) ?? { storeId: s.storeId, key: s.departmentKey, name: s.departmentName, staff: new Set<string>(), open: [], openOverlapping: 0 };
      if (s.staffId !== null) {
        g.staff.add(s.staffId);
      } else {
        g.openOverlapping++;
        if (s.date === q.date && s.startHour >= startHour && s.startHour < endHour) {
          g.open.push({ shiftId: s.shiftId, date: s.date, startHour: s.startHour, endHour: s.endHour });
        }
      }
      groups.set(k, g);
    }
    return [...groups.values()]
      .map((g) => ({
        storeId: g.storeId,
        departmentKey: g.key,
        departmentName: g.name,
        rostered: g.staff.size,
        required: g.staff.size + g.openOverlapping,
        openShifts: g.open,
        surplus: 0,
      }))
      .sort((a, b) => (a.storeId < b.storeId ? -1 : a.storeId > b.storeId ? 1 : a.departmentKey < b.departmentKey ? -1 : 1));
  },
};
