/**
 * Sample roster data for the component gallery and tests (task 13), matching
 * the SCR-022 / SCR-025 wireframes: SM Supermarket – Quezon City, Main
 * checkout lanes, Saturday Dec 19, 2026. Simulated data (req. 18) — not real
 * SM staff. Names and times follow `_build.py` (TL_ROWS, WK, MONTH); the
 * hourly requirement is chosen so the staffing-vs-need strip shows the
 * wireframe's chips (0 −1 0 +1 0 0 −2 −2 −1 0 +1 0 …) for these rows.
 */
import type { IsoDate } from '@lanewise/shared'
import { addDays, gridDays } from './model'
import type {
  Absence,
  DayTimelineRow,
  GridCell,
  GridRow,
  HourRequirement,
  MonthDayCoverage,
  MyRosterWeek,
  OpenShift,
  RosterCashier,
  RosterDepartment,
  RosterShift,
  RosterTotals,
  ShiftActivity,
} from './types'

/** Minutes since midnight for h:mm. */
export const hm = (h: number, m = 0) => h * 60 + m

export const SAMPLE_DATE: IsoDate = '2026-12-19'

export const SAMPLE_DEPARTMENTS: readonly RosterDepartment[] = [
  { id: 'main', name: 'Main checkout lanes', shortName: 'Main lanes', letter: 'M', viz: 1 },
  { id: 'exp', name: 'Express lanes', shortName: 'Express', letter: 'E', viz: 2 },
  { id: 'cs', name: 'Customer service', shortName: 'Customer service', letter: 'C', viz: 3 },
]

const C = (c: RosterCashier) => c
export const SAMPLE_CASHIERS = {
  isa: C({ id: 'FT-01', name: 'Isa Palma', contract: 'fullTime', note: 'rest Mon', skills: ['main', 'exp'] }),
  cora: C({ id: 'FT-03', name: 'Cora Fisco', contract: 'fullTime', skills: ['main', 'cs'] }),
  ralph: C({ id: 'FT-07', name: 'Ralph Edu', contract: 'fullTime', skills: ['main'] }),
  maria: C({ id: 'PT-02', name: 'Maria Santos', contract: 'partTime', note: 'students', skills: ['main'] }),
  guy: C({ id: 'PT-05', name: 'Guy Hapin', contract: 'partTime', skills: ['exp'] }),
  dina: C({ id: 'FT-09', name: 'Dina Rusel', contract: 'fullTime', skills: ['cs', 'main'] }),
  arlene: C({ id: 'PT-06', name: 'Arlene Mac', contract: 'partTime', note: 'no Sundays', skills: ['main'] }),
  jo: C({
    id: 'XS-14',
    name: 'Jo Tan',
    contract: 'borrowed',
    skills: ['main'],
    homeStore: { name: 'SM Megamall', travelMin: 22 },
  }),
  cam: C({ id: 'FL-01', name: 'Cam Wills', contract: 'float', skills: ['main', 'exp', 'cs'] }),
} as const

const act = (kind: ShiftActivity['kind'], start: number, end: number): ShiftActivity => ({
  kind,
  startMin: start,
  endMin: end,
})

const EDIT = { by: 'R. Lim', at: '2026-12-18T18:02:00+08:00' }

function shift(
  cashier: RosterCashier,
  date: IsoDate,
  departmentId: string,
  startMin: number,
  endMin: number,
  activities: ShiftActivity[] = [],
  edited = false,
): RosterShift {
  return {
    id: `${cashier.id}-${date}`,
    cashierId: cashier.id,
    date,
    departmentId,
    startMin,
    endMin,
    activities,
    ...(edited ? { edited: EDIT } : {}),
  }
}

const { isa, cora, ralph, maria, guy, dina, arlene, jo, cam } = SAMPLE_CASHIERS
const D = SAMPLE_DATE

/** Day timeline rows (wireframe TL_ROWS). */
export const SAMPLE_DAY_ROWS: readonly DayTimelineRow[] = [
  { cashier: isa, shift: shift(isa, D, 'main', hm(9), hm(18), [act('huddle', hm(9), hm(9, 30)), act('meal', hm(13), hm(14))]) },
  { cashier: cora, shift: shift(cora, D, 'main', hm(10), hm(19), [act('training', hm(11), hm(11, 30)), act('meal', hm(14), hm(15))]) },
  { cashier: ralph, absence: 'dayOff' },
  { cashier: maria, shift: shift(maria, D, 'main', hm(12), hm(21), [act('training', hm(13, 30), hm(14)), act('meal', hm(16), hm(17))], true) },
  { cashier: guy, shift: shift(guy, D, 'exp', hm(15), hm(19)) },
  { cashier: dina, shift: shift(dina, D, 'cs', hm(8), hm(17), [act('meal', hm(12), hm(13))]) },
  { cashier: arlene, absence: 'unavailable' },
  { cashier: jo, shift: shift(jo, D, 'main', hm(13), hm(17), [], true) },
  { cashier: cam, shift: shift(cam, D, 'main', hm(11), hm(20), [act('meal', hm(15), hm(16))]) },
]

/** Required cashiers on lanes per hour (Erlang C), 7 AM – 10 PM. */
export const SAMPLE_REQUIREMENTS: readonly HourRequirement[] = [
  0, 2, 2, 2, 4, 4, 6, 7, 7, 6, 4, 4, 2, 1, 0, 0,
].map((required, i) => ({ hour: 7 + i, required }))

// ── Week grid ─────────────────────────────────────────────────────────────

type Pattern = readonly (
  | Absence
  | ''
  | readonly [dept: string, start: number, end: number]
)[]

/** Mon–Sun weekly pattern per cashier (wireframe WK), Saturday per the day view. */
const WEEK_PATTERN: readonly (readonly [RosterCashier, Pattern])[] = [
  [isa, ['dayOff', ['main', 9, 18], ['main', 9, 18], ['main', 9, 18], ['main', 9, 18], ['main', 9, 18], ['main', 10, 19]]],
  [cora, [['main', 10, 19], ['main', 10, 19], 'dayOff', ['main', 10, 19], ['main', 10, 19], ['main', 10, 19], ['main', 10, 19]]],
  [maria, ['unavailable', ['main', 15, 19], '', ['main', 15, 19], '', ['main', 12, 21], '']],
  [guy, ['', ['exp', 15, 19], ['exp', 15, 19], '', ['exp', 17, 21], ['exp', 15, 19], ['exp', 13, 17]]],
  [dina, [['cs', 8, 17], ['cs', 8, 17], 'dayOff', ['cs', 8, 17], ['cs', 8, 17], ['cs', 8, 17], ['cs', 9, 18]]],
  [jo, ['', '', '', '', '', ['main', 13, 17], '']],
]

/** Grid rows for any run of days, repeating the weekly pattern by weekday. */
export function sampleGridRows(days: readonly IsoDate[]): GridRow[] {
  return WEEK_PATTERN.map(([cashier, pattern]) => {
    const cells: Record<IsoDate, GridCell> = {}
    days.forEach((date, i) => {
      const p = pattern[i % 7]
      if (p === 'dayOff' || p === 'unavailable') cells[date] = { kind: 'absence', absence: p }
      else if (p) {
        const [dept, a, b] = p
        const onDay = SAMPLE_DAY_ROWS.find((r) => r.cashier.id === cashier.id && r.shift)
        cells[date] =
          date === SAMPLE_DATE && onDay?.shift
            ? { kind: 'shift', shift: onDay.shift }
            : { kind: 'shift', shift: shift(cashier, date, dept, hm(a), hm(b), b - a >= 8 ? [act('meal', hm(a + 4), hm(a + 5))] : []) }
      }
    })
    return { cashier, cells }
  })
}

export const SAMPLE_WEEK_DAYS: readonly IsoDate[] = gridDays(SAMPLE_DATE, 'week')

export const SAMPLE_OPEN_SHIFTS: readonly OpenShift[] = [
  { id: 'open-19', date: '2026-12-19', departmentId: 'main', startMin: hm(13), endMin: hm(17), count: 2 },
  { id: 'open-24', date: '2026-12-24', departmentId: 'main', startMin: hm(13), endMin: hm(17), count: 2 },
]

export const SAMPLE_TOTALS: RosterTotals = {
  shifts: 112,
  cost: 98600,
  paidHours: 1184,
  openShifts: 2,
  borrowed: 1,
}

// ── Month coverage ───────────────────────────────────────────────────────

export const SAMPLE_MONTH: readonly MonthDayCoverage[] = Array.from({ length: 31 }, (_, i) => {
  const d = i + 1
  return {
    date: addDays('2026-12-01', i),
    shifts: d % 7 ? 112 : 98,
    openShifts: d === 19 || d === 24 ? 2 : 0,
  }
})

// ── My roster (PT-02 Maria Santos) ──────────────────────────────────────

const mariaSat = SAMPLE_DAY_ROWS.find((r) => r.cashier.id === 'PT-02')!.shift!

export const SAMPLE_MY_WEEKS: readonly MyRosterWeek[] = [
  {
    id: '2026-12-14',
    start: '2026-12-14',
    days: [
      { date: '2026-12-14', absence: 'dayOff' },
      { date: '2026-12-15', shift: shift(maria, '2026-12-15', 'main', hm(15), hm(19)), payday: true },
      { date: '2026-12-16', absence: 'unavailable' },
      { date: '2026-12-17', shift: shift(maria, '2026-12-17', 'main', hm(15), hm(19)) },
      { date: '2026-12-19', shift: mariaSat, previous: { startMin: hm(13), endMin: hm(17) } },
    ],
  },
  {
    id: '2026-12-21',
    start: '2026-12-21',
    days: [
      { date: '2026-12-21', absence: 'dayOff' },
      { date: '2026-12-22', shift: shift(maria, '2026-12-22', 'main', hm(15), hm(19)) },
      { date: '2026-12-23', shift: shift(maria, '2026-12-23', 'main', hm(15), hm(19)) },
      { date: '2026-12-26', shift: shift(maria, '2026-12-26', 'main', hm(12), hm(21), [act('meal', hm(16), hm(17))]) },
    ],
  },
  { id: '2026-12-28', start: '2026-12-28', days: [] },
]

export const SAMPLE_MY_LATEST_CHANGE = SAMPLE_MY_WEEKS[0].days[4]
