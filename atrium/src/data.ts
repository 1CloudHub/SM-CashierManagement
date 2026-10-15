import type { Lang } from './i18n'

export type LiveApp = 'lanewise' | 'proposal' | 'exec'

export interface AppTile {
  readonly id: string
  readonly name: Record<Lang, string>
  readonly color: string
  /** Inline stroke icon path (24×24). */
  readonly icon: string
  /** Live apps open; concept apps show a roadmap note. */
  readonly live?: LiveApp
  /** Queue source names that badge this tile. */
  readonly sources?: readonly string[]
}

export const APPS: readonly AppTile[] = [
  { id: 'lanewise', live: 'lanewise', name: { en: 'LaneWise', fil: 'LaneWise' }, color: 'var(--blue)', icon: 'M4 19V9M9 19V5M14 19v-7M19 19V8M3 19h18', sources: ['LaneWise'] },
  { id: 'proposal', live: 'proposal', name: { en: 'Proposal', fil: 'Proposal' }, color: 'var(--navy)', icon: 'M4 5h16v11H4zM12 16v4M8 20h8M8 9h8M8 12h5', sources: ['1CloudHub'] },
  { id: 'exec', live: 'exec', name: { en: 'Exec summary', fil: 'Exec summary' }, color: 'var(--plum)', icon: 'M6 3h9l3 3v15H6zM9 9h6M9 13h6M9 17h3', sources: ['1CloudHub'] },
  { id: 'roster', name: { en: 'Roster', fil: 'Roster' }, color: 'var(--blue)', icon: 'M4 6h16M4 12h16M4 18h16' },
  { id: 'leave', name: { en: 'Leave', fil: 'Leave' }, color: 'var(--teal)', icon: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4' },
  { id: 'attendance', name: { en: 'Attendance', fil: 'Attendance' }, color: 'var(--blue)', icon: 'M3 12h4l2-6 4 12 2-6h6', sources: ['Attendance'] },
  { id: 'requests', name: { en: 'Requests', fil: 'Requests' }, color: 'var(--navy)', icon: 'M7 4h10v16H7zM10 8h4M10 12h4M10 16h2', sources: ['Requests'] },
  { id: 'hrms', name: { en: 'HRMS', fil: 'HRMS' }, color: 'var(--blue)', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1-4 4-6 8-6s7 2 8 6' },
  { id: 'learning', name: { en: 'Learning', fil: 'Learning' }, color: 'var(--teal)', icon: 'M3 8l9-4 9 4-9 4zM7 10v5c3 2 7 2 10 0v-5' },
  { id: 'ithelp', name: { en: 'IT help', fil: 'IT help' }, color: 'var(--slate)', icon: 'M4 14v-2a8 8 0 0 1 16 0v2M3 14h4v6H3zM17 14h4v6h-4z', sources: ['IT help'] },
]

export type Effect = { kind: 'simulate' } | { kind: 'open'; app: LiveApp }

export interface ItemCopy {
  readonly short: string
  readonly title: string
  readonly lede: string
  readonly facts: readonly (readonly [string, string, boolean?])[]
  readonly primary: string
  readonly alt?: string
  readonly secondary?: string
  readonly why?: string
  readonly people?: readonly string[]
}

export interface QueueItem {
  readonly id: string
  readonly group: 'need' | 'fyi'
  readonly src: string
  readonly agent?: string
  readonly age: Record<Lang, string>
  readonly people?: readonly { readonly n: string; readonly ot: string; readonly best?: boolean }[]
  readonly onPrimary: Effect
  readonly onAlt?: Effect
  readonly onSecondary?: Effect
  readonly copy: Record<Lang, ItemCopy>
}

const sim: Effect = { kind: 'simulate' }

export const QUEUE: readonly QueueItem[] = [
  {
    id: 'coverage',
    group: 'need',
    src: 'Attendance',
    agent: 'Coverage agent',
    age: { en: '05:40', fil: '05:40' },
    people: [{ n: 'Cashier #4502', ot: '6.0', best: true }, { n: 'Cashier #4388', ot: '4.5' }, { n: 'Cashier #5117', ot: '8.0' }],
    onPrimary: sim,
    onAlt: sim,
    onSecondary: sim,
    copy: {
      en: {
        short: 'Cashier short · Sat 20 Dec',
        title: "Saturday 20 Dec: you'd be 1 cashier short",
        lede: 'Cashier #4471 asked for leave on a peak Saturday. Approving it takes the 10:00 to 19:00 shift one under the store minimum.',
        facts: [['Store minimum, peak Saturday', '6'], ['Rostered', '8'], ['Already on approved leave', '2'], ['On shift if approved', '5', true]],
        people: ['Store 0123 · knows counters 1 to 4', 'Store 0123', 'Store 0127 · 1.2 km away'],
        primary: 'Approve and offer the shift',
        alt: 'Approve only',
        secondary: 'Decline',
        why: 'the coverage agent checks every leave request against the roster and the peak-day minimum set by Store Ops.',
      },
      fil: {
        short: 'Kulang ng cashier · Sab 20 Dis',
        title: 'Sabado 20 Dis: kulang ka ng 1 cashier',
        lede: 'Nag-file ng leave si Cashier #4471 sa isang peak na Sabado. Kapag inaprubahan, bababa sa minimum ng tindahan ang shift na 10:00 hanggang 19:00.',
        facts: [['Minimum ng tindahan, peak na Sabado', '6'], ['Naka-roster', '8'], ['Naka-approve na ang leave', '2'], ['Naka-shift kapag inaprubahan', '5', true]],
        people: ['Store 0123 · alam ang counter 1 hanggang 4', 'Store 0123', 'Store 0127 · 1.2 km ang layo'],
        primary: 'Aprubahan at i-offer ang shift',
        alt: 'Aprubahan lang',
        secondary: 'Tanggihan',
        why: 'sinusuri ng coverage agent ang bawat leave request laban sa roster at sa peak-day minimum na itinakda ng Store Ops.',
      },
    },
  },
  {
    id: 'proposal',
    group: 'need',
    src: '1CloudHub',
    age: { en: 'today', fil: 'ngayon' },
    onPrimary: { kind: 'open', app: 'proposal' },
    onAlt: { kind: 'open', app: 'exec' },
    copy: {
      en: {
        short: 'SM Atrium proposal to review',
        title: 'The SM Atrium proposal is ready for your review',
        lede: "1CloudHub's proposal for one platform underneath every internal app: the situation, the plan, the architecture and the first steps.",
        facts: [['Full proposal', 'Deck · 49 slides'], ['Exec summary', 'Deck · 7 slides'], ['Shared with', 'SM Retail IT']],
        primary: 'Open the proposal',
        alt: 'Open the Exec summary',
      },
      fil: {
        short: 'Proposal ng SM Atrium na rerepasuhin',
        title: 'Handa na para sa iyong review ang proposal ng SM Atrium',
        lede: 'Ang proposal ng 1CloudHub para sa iisang platform sa ilalim ng bawat internal app: ang sitwasyon, ang plano, ang arkitektura at ang mga unang hakbang.',
        facts: [['Buong proposal', 'Deck · 49 slide'], ['Exec summary', 'Deck · 7 slide'], ['Ibinahagi sa', 'SM Retail IT']],
        primary: 'Buksan ang proposal',
        alt: 'Buksan ang Exec summary',
      },
    },
  },
  {
    id: 'phone',
    group: 'need',
    src: 'Requests',
    age: { en: '2 days', fil: '2 araw' },
    onPrimary: sim,
    onSecondary: sim,
    copy: {
      en: {
        short: 'Phone request #2291',
        title: 'Mobile phone request #2291',
        lede: 'A new hire at Store 0123 needs a store handset before their first shift on 18 Dec.',
        facts: [['Requested by', 'Team lead, ST 0123'], ['Item', 'Standard store handset'], ['After you', 'Area manager']],
        primary: 'Approve',
        secondary: 'Decline',
      },
      fil: {
        short: 'Request ng phone #2291',
        title: 'Request ng mobile phone #2291',
        lede: 'Kailangan ng bagong empleyado sa Store 0123 ng store handset bago ang una nilang shift sa 18 Dis.',
        facts: [['Hiniling ni', 'Team lead, ST 0123'], ['Item', 'Standard na store handset'], ['Susunod sa iyo', 'Area manager']],
        primary: 'Aprubahan',
        secondary: 'Tanggihan',
      },
    },
  },
  {
    id: 'lanewise',
    group: 'fyi',
    src: 'LaneWise',
    age: { en: 'new', fil: 'bago' },
    onPrimary: { kind: 'open', app: 'lanewise' },
    copy: {
      en: {
        short: 'LaneWise is live',
        title: 'LaneWise is live: cashier staffing, from forecast to hiring plan',
        lede: 'The first app built the Atrium way. It opens already signed in, with the same account you used here.',
        facts: [['What it does', 'Forecast → lanes → shifts → roster → hiring'], ['Sign-in', 'Carried over from Atrium'], ['Built on', 'The Atrium blueprint']],
        primary: 'Open LaneWise',
      },
      fil: {
        short: 'Live na ang LaneWise',
        title: 'Live na ang LaneWise: cashier staffing, mula forecast hanggang hiring plan',
        lede: 'Ang unang app na ginawa sa paraan ng Atrium. Bukas na itong naka-sign in, gamit ang parehong account na ginamit mo rito.',
        facts: [['Ginagawa nito', 'Forecast → lane → shift → roster → hiring'], ['Sign-in', 'Dala mula sa Atrium'], ['Batay sa', 'Ang blueprint ng Atrium']],
        primary: 'Buksan ang LaneWise',
      },
    },
  },
  {
    id: 'printer',
    group: 'fyi',
    src: 'IT help',
    age: { en: '08:12', fil: '08:12' },
    onPrimary: sim,
    copy: {
      en: {
        short: 'Printer at counter 3 fixed',
        title: 'Resolved: receipt printer at counter 3',
        lede: 'The service desk replaced the printer cable. Counter 3 is back in use.',
        facts: [['Opened', 'Sun 14 Dec, 19:05'], ['Closed', 'Mon 15 Dec, 08:12']],
        primary: 'Close',
      },
      fil: {
        short: 'Naayos ang printer sa counter 3',
        title: 'Naayos: receipt printer sa counter 3',
        lede: 'Pinalitan ng service desk ang cable ng printer. Gumagana na ulit ang counter 3.',
        facts: [['Binuksan', 'Lin 14 Dis, 19:05'], ['Isinara', 'Lun 15 Dis, 08:12']],
        primary: 'Isara',
      },
    },
  },
]
