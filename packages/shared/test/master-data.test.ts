import { describe, expect, it } from 'vitest';
import {
  FULL_AVAILABILITY,
  STAFF_TYPES,
  WEEKDAYS,
  availableWindowCount,
  dowToWeekday,
  normalizeAvailability,
  staffTypeOf,
  storeRollup,
  weekdayToDow,
  CONTRACT_TYPE_BY_STAFF_TYPE,
  EMPLOYMENT_TYPE_BY_STAFF_TYPE,
} from '../src/index.js';

describe('master data helpers (SCR-052/053)', () => {
  it('round-trips weekdays through the 0 = Sunday numbering', () => {
    expect(weekdayToDow('sun')).toBe(0);
    expect(weekdayToDow('mon')).toBe(1);
    for (const d of WEEKDAYS) expect(dowToWeekday(weekdayToDow(d))).toBe(d);
    expect(dowToWeekday(7)).toBeNull();
  });

  it('round-trips staff types through employment + contract type', () => {
    for (const t of STAFF_TYPES) {
      expect(staffTypeOf(EMPLOYMENT_TYPE_BY_STAFF_TYPE[t], CONTRACT_TYPE_BY_STAFF_TYPE[t])).toBe(t);
    }
    expect(staffTypeOf('regular', undefined)).toBe('full_time');
    expect(staffTypeOf('seasonal', undefined)).toBe('seasonal');
  });

  it('reads a stored availability pattern defensively', () => {
    expect(normalizeAvailability(undefined)).toEqual(FULL_AVAILABILITY);
    const read = normalizeAvailability({ mon: ['evening', 'night', 'morning', 'morning'], tue: [] });
    expect(read.mon).toEqual(['morning', 'evening']);
    expect(read.tue).toEqual([]);
    expect(read.wed).toEqual(['morning', 'afternoon', 'evening']);
    expect(availableWindowCount(read)).toBe(17);
  });

  it('rolls up active departments for the store row', () => {
    const dept = (open: string, close: string, lanes: number, active = true) => ({
      id: open,
      storeId: 's',
      name: open,
      installedLanes: lanes,
      defaultHandleTimeMin: 2,
      tradingHours: { open, close },
      active,
      synthetic: false,
    });
    expect(storeRollup([dept('09:00', '21:00', 10), dept('10:00', '22:00', 5), dept('06:00', '23:00', 99, false)])).toEqual({
      installedLanes: 15,
      tradingHours: { open: '09:00', close: '22:00' },
    });
    expect(storeRollup([])).toEqual({ installedLanes: 0, tradingHours: null });
  });
});
