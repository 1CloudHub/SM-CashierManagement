import type {
  ApprovalStepKind,
  IsoDate,
  IsoDateTime,
  RoleCode,
  ScenarioSummary,
  StoreFormat,
} from '@lanewise/shared'

/**
 * SPA-side read models for endpoints that land with their feature tasks.
 * Built from the @lanewise/shared entity types; they move into the shared
 * package when the API implements them. Every figure is already filtered to
 * the active role's permissions and scope by the server (P1, P11) — e.g. a
 * Staff home never carries a ₱ amount or another cashier's name. ₱ fields
 * are optional because the server removes them for roles that may not see
 * cost at that level (task 21); render them with `<CostValue>`.
 */

/** `GET /home` — the SCR-010 dashboard for the active role. */
export interface HomeSummary {
  readonly role: RoleCode
  readonly firstName: string
  /** Planner: things to act on. */
  readonly attention?: readonly HomeAttentionItem[]
  /** Planner: season milestones. */
  readonly deadlines?: readonly HomeDeadline[]
  /** EXE / HR / FIN: the approval step waiting on this role. */
  readonly pendingApproval?: HomePendingApproval
  /** EXE: the published plan for the season. */
  readonly publishedPlan?: Pick<ScenarioSummary, 'id' | 'name'>
  /** STM: the manager's store this week. */
  readonly storeWeek?: HomeStoreWeek
  /** HR: recruiting timeline. */
  readonly recruiting?: HomeRecruiting
  /** FIN: season cost, published vs draft (₱). */
  readonly costWatch?: HomeCostWatch
  /** RST: dataset freshness. */
  readonly dataFreshness?: readonly HomeDatasetFreshness[]
  /** RST: rule versions still in draft. */
  readonly draftRules?: readonly HomeDraftRule[]
  /** STF: own upcoming shifts only (P11). */
  readonly nextShifts?: HomeNextShifts
  /** ADM: invitations not yet accepted. */
  readonly pendingInvitations?: number
  /** EXE / PLN / HR / FIN: headline season KPIs. */
  readonly kpis?: HomeKpis
  /** EXE / PLN: most recently updated scenarios. */
  readonly recentScenarios?: readonly HomeScenarioRow[]
}

export type HomeAttentionItem =
  | { readonly kind: 'staleScenarios'; readonly count: number }
  | { readonly kind: 'overCapacity'; readonly count: number; readonly date: IsoDate }
  | { readonly kind: 'runComplete'; readonly scenarioId: string; readonly scenarioName: string }

export interface HomeDeadline {
  readonly date: IsoDate
  readonly kind: 'sendOffers' | 'trainingStarts' | 'firstWave'
  /** For `firstWave`: cashiers on the lanes. */
  readonly count?: number
}

export interface HomePendingApproval {
  readonly scenarioId: string
  readonly scenarioName: string
  readonly step: ApprovalStepKind
  /** Headcount asked for (headcount step). */
  readonly headcount?: number
  /** Season cost in ₱ (budget step; network level). */
  readonly seasonCost?: number
}

export interface HomeStoreWeek {
  readonly storeName: string
  readonly departmentName: string
  readonly unfilledShifts: number
  readonly unfilledDate: IsoDate
  readonly failingRuleChecks: number
}

export interface HomeRecruiting {
  readonly offersDue: IsoDate
  readonly toRecruitMin: number
  readonly toRecruitMax: number
}

export interface HomeCostWatch {
  /** Network-level ₱ figures. */
  readonly publishedCost?: number
  readonly draftCost?: number
  readonly draftScenarioName: string
}

export interface HomeDatasetFreshness {
  readonly dataset: 'pos' | 'staff' | 'master'
  readonly loadedAt: IsoDateTime | null
}

export interface HomeDraftRule {
  readonly ruleSetId: string
  readonly name: string
  readonly version: string
}

export interface HomeNextShifts {
  readonly storeName: string
  readonly departmentName: string
  readonly shifts: readonly HomeShift[]
}

export interface HomeShift {
  readonly start: IsoDateTime
  readonly end: IsoDateTime
  readonly mealStart?: IsoDateTime
  readonly changed: boolean
}

export interface HomeKpis {
  readonly seasonalHires: number
  readonly fullTime: number
  readonly partTime: number
  readonly toRecruitMin: number
  readonly toRecruitMax: number
  readonly firstNeeded: IsoDate
  readonly offersDue: IsoDate
  /** Network-level ₱ figure. */
  readonly seasonCost?: number
}

export interface HomeScenarioRow
  extends Pick<ScenarioSummary, 'id' | 'name' | 'status' | 'stale' | 'updatedAt'> {
  readonly ownerName: string
}

/**
 * `GET /context-options` — the planning context bar's choices (task 20),
 * already limited to the active role's scope by the server (P1). Lands in the
 * API with the planning screens (task 14); the mock serves it until then.
 */
export interface ContextOptions {
  readonly scenarios: readonly Pick<ScenarioSummary, 'id' | 'name' | 'status' | 'stale'>[]
  readonly regions: readonly { readonly id: string; readonly name: string }[]
  readonly formats: readonly StoreFormat[]
  readonly stores: readonly {
    readonly id: string
    readonly name: string
    readonly regionId: string
    readonly format: StoreFormat
  }[]
  readonly departments: readonly { readonly id: string; readonly name: string; readonly storeId: string }[]
  /** Planning seasons (hiring plan). */
  readonly seasons: readonly { readonly id: string; readonly start: IsoDate; readonly end: IsoDate }[]
}
