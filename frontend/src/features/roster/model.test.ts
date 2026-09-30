import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  gridDays,
  hourlyDeltas,
  isOnLaneAt,
  monthWeeks,
  moveShift,
  paidMinutes,
  resizeShift,
  rosteredAtHour,
  snapMinutes,
  startOfWeek,
  stepAnchor,
} from './model'
import { SAMPLE_DAY_ROWS, SAMPLE_REQUIREMENTS, hm } from './fixtures'
import type { DayWindow, ShiftActivity } from './types'

const W: DayWindow = { startHour: 7, endHour: 23 }

describe('snap, move and resize (15-min snap, clamped to the window)', () => {
  it('snaps to the nearest step', () => {
    expect(snapMinutes(hm(9, 7))).toBe(hm(9, 0))
    expect(snapMinutes(hm(9, 8))).toBe(hm(9, 15))
    expect(snapMinutes(hm(9, 29), 60)).toBe(hm(9))
  })

  it('moves a shift keeping its length and stays inside the window', () => {
    expect(moveShift({ startMin: hm(9), endMin: hm(18) }, 15, W)).toEqual({ startMin: hm(9, 15), endMin: hm(18, 15) })
    expect(moveShift({ startMin: hm(9), endMin: hm(18) }, -600, W)).toEqual({ startMin: hm(7), endMin: hm(16) })
    expect(moveShift({ startMin: hm(20), endMin: hm(22) }, 600, W)).toEqual({ startMin: hm(21), endMin: hm(23) })
  })

  it('resizes an edge but never below one snap step', () => {
    expect(resizeShift({ startMin: hm(9), endMin: hm(18) }, 'end', 60, W)).toEqual({ startMin: hm(9), endMin: hm(19) })
    expect(resizeShift({ startMin: hm(9), endMin: hm(10) }, 'end', -600, W)).toEqual({ startMin: hm(9), endMin: hm(9, 15) })
    expect(resizeShift({ startMin: hm(9), endMin: hm(10) }, 'start', 600, W)).toEqual({ startMin: hm(9, 45), endMin: hm(10) })
  })

  it('property: moves and resizes always stay snapped, inside the window and non-empty', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 28, max: 88 }),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: -2000, max: 2000 }),
        fc.constantFrom('move', 'start', 'end'),
        (startQ, lenQ, delta, kind) => {
          const startMin = startQ * 15
          const endMin = Math.min(hm(23), startMin + lenQ * 15)
          fc.pre(endMin > startMin)
          const next =
            kind === 'move'
              ? moveShift({ startMin, endMin }, delta, W)
              : resizeShift({ startMin, endMin }, kind as 'start' | 'end', delta, W)
          expect(next.startMin % 15).toBe(0)
          expect(next.endMin % 15).toBe(0)
          expect(next.startMin).toBeGreaterThanOrEqual(hm(7))
          expect(next.endMin).toBeLessThanOrEqual(hm(23))
          expect(next.endMin).toBeGreaterThan(next.startMin)
          if (kind === 'move') expect(next.endMin - next.startMin).toBe(endMin - startMin)
        },
      ),
    )
  })
})

describe('coverage and staffing vs need', () => {
  it('a meal, training or huddle takes the cashier off the lane', () => {
    const s = { startMin: hm(9), endMin: hm(18), activities: [{ kind: 'meal', startMin: hm(13), endMin: hm(14) }] as ShiftActivity[] }
    expect(isOnLaneAt(s, hm(12, 30))).toBe(true)
    expect(isOnLaneAt(s, hm(13, 30))).toBe(false)
    expect(isOnLaneAt(s, hm(18))).toBe(false)
  })

  it('reproduces the SCR-022 wireframe strip for the sample Saturday', () => {
    const shifts = SAMPLE_DAY_ROWS.flatMap((r) => (r.shift ? [r.shift] : []))
    expect(hourlyDeltas(shifts, SAMPLE_REQUIREMENTS, W).map((d) => d.delta)).toEqual([
      0, -1, 0, 1, 0, 0, -2, -2, -1, 0, 1, 0, 0, 0, 0, 0,
    ])
  })

  it('paid minutes exclude meals only', () => {
    const s = SAMPLE_DAY_ROWS.find((r) => r.cashier.id === 'PT-02')!.shift!
    expect(paidMinutes(s)).toBe(8 * 60)
  })

  it('property: every hour’s delta equals rostered minus required', () => {
    const activity = fc
      .record({
        kind: fc.constantFrom('meal', 'training', 'huddle') as fc.Arbitrary<ShiftActivity['kind']>,
        start: fc.integer({ min: 28, max: 90 }),
        len: fc.integer({ min: 1, max: 4 }),
      })
      .map(({ kind, start, len }) => ({ kind, startMin: start * 15, endMin: (start + len) * 15 }))
    const shift = fc
      .record({
        start: fc.integer({ min: 28, max: 88 }),
        len: fc.integer({ min: 1, max: 48 }),
        activities: fc.array(activity, { maxLength: 3 }),
      })
      .map(({ start, len, activities }) => ({
        startMin: start * 15,
        endMin: Math.min(92, start + len) * 15,
        activities,
      }))
      .filter((s) => s.endMin > s.startMin)
    const reqs = fc.array(fc.integer({ min: 0, max: 30 }), { minLength: 16, maxLength: 16 })

    fc.assert(
      fc.property(fc.array(shift, { maxLength: 30 }), reqs, (shifts, required) => {
        const requirements = required.map((r, i) => ({ hour: 7 + i, required: r }))
        const deltas = hourlyDeltas(shifts, requirements, W)
        expect(deltas).toHaveLength(16)
        deltas.forEach((d, i) => {
          // Independent oracle: count cashiers on a lane at hh:30.
          const mid = (7 + i) * 60 + 30
          const oracle = shifts.filter(
            (s) =>
              s.startMin <= mid &&
              mid < s.endMin &&
              !s.activities.some((a) => a.startMin <= mid && mid < a.endMin),
          ).length
          expect(d.rostered).toBe(oracle)
          expect(d.rostered).toBe(rosteredAtHour(shifts, 7 + i))
          expect(d.required).toBe(required[i])
          expect(d.delta).toBe(oracle - required[i])
        })
      }),
    )
  })
})

describe('calendar ranges for each zoom', () => {
  it('weeks start on Monday', () => {
    expect(startOfWeek('2026-12-19')).toBe('2026-12-14')
    expect(startOfWeek('2026-12-14')).toBe('2026-12-14')
    expect(startOfWeek('2026-12-20')).toBe('2026-12-14')
  })

  it('grid zooms show 7, 14 and 28 consecutive days', () => {
    expect(gridDays('2026-12-19', 'week')).toEqual([
      '2026-12-14', '2026-12-15', '2026-12-16', '2026-12-17', '2026-12-18', '2026-12-19', '2026-12-20',
    ])
    expect(gridDays('2026-12-19', 'fortnight')).toHaveLength(14)
    expect(gridDays('2026-12-19', 'fourWeeks').at(-1)).toBe('2027-01-10')
  })

  it('month weeks pad to Monday–Sunday rows', () => {
    const weeks = monthWeeks('2026-12-19')
    expect(weeks[0]).toEqual([null, '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06'])
    expect(weeks.flat().filter(Boolean)).toHaveLength(31)
    expect(weeks.every((w) => w.length === 7)).toBe(true)
  })

  it('the navigator steps one unit of the zoom', () => {
    expect(stepAnchor('2026-12-19', 'day', 1)).toBe('2026-12-20')
    expect(stepAnchor('2026-12-19', 'week', -1)).toBe('2026-12-12')
    expect(stepAnchor('2026-12-19', 'fortnight', 1)).toBe('2027-01-02')
    expect(stepAnchor('2026-12-19', 'fourWeeks', 1)).toBe('2027-01-16')
    expect(stepAnchor('2026-01-31', 'month', 1)).toBe('2026-02-28')
  })
})
