import { ROLE_CODES, type RoleCode } from '@lanewise/shared'

/**
 * Screen map (design.md › Screen inventory; wireframes/index.html) — one route
 * per signed-in screen, the roles that may open it and where it sits in the
 * side nav.
 *
 * `roles` mirrors each wireframe page's `data-page-roles`, and the nav groups
 * mirror the wireframe `NAV` table in wireframes/_build.py (a test parses both,
 * so drift fails CI). This is the UI half of requirement 2.3 (hide what the
 * role cannot open); the server enforces the same matrix per request (task
 * 8.1, P12) — hiding here is never the control.
 *
 * All labels are i18n message ids (src/i18n/app-messages.ts).
 */
export type ScreenId =
  | 'SCR-010'
  | 'SCR-020'
  | 'SCR-021'
  | 'SCR-022'
  | 'SCR-023'
  | 'SCR-024'
  | 'SCR-025'
  | 'SCR-026'
  | 'SCR-030'
  | 'SCR-031'
  | 'SCR-032'
  | 'SCR-033'
  | 'SCR-040'
  | 'SCR-041'
  | 'SCR-050'
  | 'SCR-051'
  | 'SCR-052'
  | 'SCR-053'
  | 'SCR-060'
  | 'SCR-061'
  | 'SCR-070'
  | 'SCR-071'
  | 'SCR-072'
  | 'SCR-073'
  | 'SCR-080'
  | 'SCR-090'
  | 'SCR-091'

export type SectionId = 'plan' | 'scenarios' | 'data' | 'rules' | 'admin'

export interface ScreenDef {
  readonly id: ScreenId
  /** react-router path pattern. */
  readonly path: string
  /** Page title / final breadcrumb. */
  readonly titleKey: string
  /** Section crumb between Home and the title (wireframe breadcrumbs). */
  readonly section?: SectionId
  readonly roles: readonly RoleCode[]
  /** Spec task that builds the real screen (placeholders only). */
  readonly task?: string
}

const ALL = ROLE_CODES
const PLANNING: readonly RoleCode[] = ['EXE', 'PLN', 'STM', 'HR', 'FIN', 'RST']

export const SCREENS: readonly ScreenDef[] = [
  { id: 'SCR-010', path: '/', titleKey: 'screen.home', roles: ALL },
  { id: 'SCR-020', path: '/plan/network', titleKey: 'screen.network', section: 'plan', roles: PLANNING, task: '14.1' },
  { id: 'SCR-021', path: '/plan/department', titleKey: 'screen.department', section: 'plan', roles: PLANNING, task: '14.1' },
  { id: 'SCR-022', path: '/plan/roster', titleKey: 'screen.roster', section: 'plan', roles: ['EXE', 'PLN', 'STM', 'HR', 'FIN'], task: '13' },
  { id: 'SCR-023', path: '/plan/hiring', titleKey: 'screen.hiring', section: 'plan', roles: ['EXE', 'PLN', 'STM', 'HR', 'FIN'], task: '14.2' },
  { id: 'SCR-024', path: '/plan/summary', titleKey: 'screen.summary', section: 'plan', roles: ['EXE', 'PLN', 'HR', 'FIN'], task: '14.3' },
  { id: 'SCR-025', path: '/my-roster', titleKey: 'screen.myRoster', roles: ['STF'], task: '18.1' },
  { id: 'SCR-026', path: '/plan/map', titleKey: 'screen.map', section: 'plan', roles: ['EXE', 'PLN', 'STM', 'HR'], task: '16.1' },
  { id: 'SCR-030', path: '/scenarios', titleKey: 'screen.scenarios', section: 'scenarios', roles: PLANNING, task: '11.1' },
  { id: 'SCR-031', path: '/scenarios/:scenarioId/settings', titleKey: 'screen.scenarioSettings', section: 'scenarios', roles: PLANNING, task: '11.1' },
  { id: 'SCR-032', path: '/scenarios/compare', titleKey: 'screen.compare', section: 'scenarios', roles: ['EXE', 'PLN', 'HR', 'FIN'], task: '11.3' },
  { id: 'SCR-033', path: '/approvals', titleKey: 'screen.approvals', section: 'scenarios', roles: ['EXE', 'HR', 'FIN'], task: '12' },
  { id: 'SCR-040', path: '/notifications', titleKey: 'screen.notifications', roles: ALL, task: '19' },
  { id: 'SCR-041', path: '/search', titleKey: 'screen.search', roles: ['ADM', 'EXE', 'PLN', 'STM', 'HR', 'FIN', 'RST'], task: '20' },
  { id: 'SCR-050', path: '/data/sources', titleKey: 'screen.dataSources', section: 'data', roles: ['ADM', 'PLN', 'RST'], task: '9.1' },
  { id: 'SCR-051', path: '/data/upload', titleKey: 'screen.upload', section: 'data', roles: ['RST'], task: '9.1' },
  { id: 'SCR-052', path: '/data/stores', titleKey: 'screen.masterData', section: 'data', roles: ['EXE', 'PLN', 'STM', 'HR', 'RST'], task: '9.1' },
  { id: 'SCR-053', path: '/data/staff', titleKey: 'screen.staff', section: 'data', roles: ['PLN', 'STM', 'HR', 'RST'], task: '9.1' },
  { id: 'SCR-060', path: '/rules', titleKey: 'screen.ruleSets', section: 'rules', roles: ['EXE', 'PLN', 'HR', 'FIN', 'RST'], task: '10.1' },
  { id: 'SCR-061', path: '/rules/:ruleSetId/edit', titleKey: 'screen.ruleEditor', section: 'rules', roles: ['ADM', 'FIN', 'RST'], task: '10.2' },
  { id: 'SCR-070', path: '/admin/users', titleKey: 'screen.users', section: 'admin', roles: ['ADM'], task: '8.1' },
  { id: 'SCR-071', path: '/admin/users/invite', titleKey: 'screen.inviteUser', section: 'admin', roles: ['ADM'], task: '8.1' },
  { id: 'SCR-072', path: '/admin/roles', titleKey: 'screen.roles', section: 'admin', roles: ['ADM'], task: '8.1' },
  { id: 'SCR-073', path: '/admin/audit', titleKey: 'screen.audit', section: 'admin', roles: ['ADM', 'RST'], task: '8.1' },
  { id: 'SCR-080', path: '/profile', titleKey: 'screen.profile', roles: ALL },
  { id: 'SCR-090', path: '/status/:kind', titleKey: 'screen.status', roles: ALL },
  { id: 'SCR-091', path: '/help', titleKey: 'screen.help', roles: ALL },
]

export const SCREEN_BY_ID: Readonly<Record<ScreenId, ScreenDef>> = Object.fromEntries(
  SCREENS.map((s) => [s.id, s]),
) as Record<ScreenId, ScreenDef>

/** Section crumb label + landing screen (wireframe breadcrumbs). */
export const SECTIONS: Readonly<Record<SectionId, { labelKey: string; landing: ScreenId }>> = {
  plan: { labelKey: 'nav.section.plan', landing: 'SCR-020' },
  scenarios: { labelKey: 'nav.section.scenarios', landing: 'SCR-030' },
  data: { labelKey: 'nav.section.data', landing: 'SCR-050' },
  rules: { labelKey: 'nav.section.rules', landing: 'SCR-060' },
  admin: { labelKey: 'nav.section.admin', landing: 'SCR-070' },
}

export interface NavItemDef {
  readonly screen: ScreenId
  readonly labelKey: string
  /** Decorative glyph from the wireframe nav. */
  readonly icon: string
}

export interface NavSectionDef {
  readonly titleKey?: string
  readonly items: readonly NavItemDef[]
}

/** The side nav, in wireframe order (wireframes/_build.py `NAV`). */
export const NAV: readonly NavSectionDef[] = [
  {
    items: [
      { screen: 'SCR-010', labelKey: 'nav.home', icon: '⌂' },
      { screen: 'SCR-025', labelKey: 'nav.myRoster', icon: 'M' },
    ],
  },
  {
    titleKey: 'nav.section.plan',
    items: [
      { screen: 'SCR-020', labelKey: 'nav.network', icon: 'N' },
      { screen: 'SCR-026', labelKey: 'nav.map', icon: '◉' },
      { screen: 'SCR-021', labelKey: 'nav.department', icon: 'D' },
      { screen: 'SCR-022', labelKey: 'nav.roster', icon: 'R' },
      { screen: 'SCR-023', labelKey: 'nav.hiring', icon: 'H' },
      { screen: 'SCR-024', labelKey: 'nav.summary', icon: 'S' },
    ],
  },
  {
    titleKey: 'nav.section.scenarios',
    items: [
      { screen: 'SCR-030', labelKey: 'nav.scenarios', icon: '☰' },
      { screen: 'SCR-032', labelKey: 'nav.compare', icon: '⇄' },
      { screen: 'SCR-033', labelKey: 'nav.approvals', icon: '✓' },
    ],
  },
  {
    titleKey: 'nav.section.data',
    items: [
      { screen: 'SCR-050', labelKey: 'nav.dataSources', icon: '⇪' },
      { screen: 'SCR-052', labelKey: 'nav.masterData', icon: '▦' },
      { screen: 'SCR-053', labelKey: 'nav.staff', icon: '☺' },
    ],
  },
  {
    titleKey: 'nav.section.rules',
    items: [{ screen: 'SCR-060', labelKey: 'nav.ruleSets', icon: '§' }],
  },
  {
    titleKey: 'nav.section.admin',
    items: [
      { screen: 'SCR-070', labelKey: 'nav.users', icon: 'U' },
      { screen: 'SCR-072', labelKey: 'nav.roles', icon: 'P' },
      { screen: 'SCR-073', labelKey: 'nav.audit', icon: 'A' },
    ],
  },
]
