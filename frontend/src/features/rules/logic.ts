/**
 * Pure helpers for the rule screens (SCR-060/061): walking and editing rule
 * payloads as leaf fields, and deciding which actions the active role may take
 * on a version (Req 16.3, 16.4). The server re-checks everything (P12).
 */
import {
  OPEN_RULE_VERSION_STATUSES,
  canPublishRuleVersion,
  hasRulePermission,
  isRuleVersionEditable,
  ruleVersionTransition,
  type RoleCode,
  type RuleVersionDiff,
  type RuleVersionStatus,
  type RuleVersionSummary,
} from '@lanewise/shared'

export type LeafPath = readonly (string | number)[]

export interface Leaf {
  readonly path: LeafPath
  readonly value: string | number | boolean | null
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Every scalar leaf of a JSON payload, in document order. */
export function flattenLeaves(value: unknown, path: LeafPath = []): Leaf[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => flattenLeaves(v, [...path, i]))
  if (isObject(value)) return Object.entries(value).flatMap(([k, v]) => flattenLeaves(v, [...path, k]))
  return [{ path, value: value as Leaf['value'] }]
}

/** Returns a copy of `root` with the leaf at `path` replaced. */
export function setLeaf(root: unknown, path: LeafPath, value: unknown): unknown {
  if (path.length === 0) return value
  const [head, ...rest] = path as [string | number, ...(string | number)[]]
  if (Array.isArray(root)) return root.map((v, i) => (i === head ? setLeaf(v, rest, value) : v))
  const obj = isObject(root) ? root : {}
  const copy: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    Object.defineProperty(copy, k, { value: v, enumerable: true, writable: true, configurable: true })
  }
  Object.defineProperty(copy, head, {
    value: setLeaf(obj[head as string], rest, value),
    enumerable: true,
    writable: true,
    configurable: true,
  })
  return copy
}

/**
 * Converts what the user typed into the leaf's type. Numbers stay numbers when
 * the text parses (otherwise the raw text is kept so validation can flag it);
 * text stays text.
 */
export function parseLeafInput(previous: Leaf['value'], input: string): string | number | boolean {
  if (typeof previous === 'number') {
    const trimmed = input.trim()
    if (trimmed === '') return input
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : input
  }
  if (typeof previous === 'boolean') return input === 'true'
  return input
}

export const pathKey = (path: LeafPath): string => path.join('.')

/** A validation error key (`hourlyRateByRegion.NCR`, `milestones.0.name`) back as a path. */
export const keyPath = (key: string): LeafPath =>
  key === '' ? [] : key.split('.').map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg))

export type LeafGroup =
  | { readonly kind: 'field'; readonly leaf: Leaf }
  /** The entries of a keyed map (e.g. the base rate per region), shown as one table. */
  | { readonly kind: 'table'; readonly path: LeafPath; readonly rows: readonly Leaf[] }

/**
 * Groups the leaves of keyed maps — whose keys are data (regions), not field
 * names — into tables; every other leaf stays a field. Document order is kept.
 */
export function groupLeaves(leaves: readonly Leaf[], isDataKey: (key: string) => boolean): LeafGroup[] {
  const out: LeafGroup[] = []
  for (const leaf of leaves) {
    const last = leaf.path[leaf.path.length - 1]
    const parent = leaf.path.slice(0, -1)
    if (parent.length === 0 || typeof last !== 'string' || !isDataKey(last)) {
      out.push({ kind: 'field', leaf })
      continue
    }
    const prev = out[out.length - 1]
    if (prev?.kind === 'table' && pathKey(prev.path) === pathKey(parent)) {
      out[out.length - 1] = { ...prev, rows: [...prev.rows, leaf] }
    } else {
      out.push({ kind: 'table', path: parent, rows: [leaf] })
    }
  }
  return out
}

export type PreviousValue = { readonly present: false } | { readonly present: true; readonly value: unknown }

/**
 * A leaf's value in the previous version ("Was"): the diff's `before` when it
 * changed, absent when it was added, else the saved value (unchanged since the
 * previous version). Nothing for the first version of a rule set.
 */
export function previousValue(diff: RuleVersionDiff, saved: ReadonlyMap<string, unknown>, path: LeafPath): PreviousValue {
  if (diff.fromVersionId === null) return { present: false }
  const key = pathKey(path)
  const change = diff.changes.find((c) => {
    const k = pathKey(c.path)
    return k === key || key.startsWith(`${k}.`)
  })
  if (change) {
    if (change.kind === 'added' || pathKey(change.path) !== key) return { present: false }
    return { present: true, value: change.before }
  }
  return saved.has(key) ? { present: true, value: saved.get(key) } : { present: false }
}

export interface VersionActions {
  /** Edit content, save the draft. */
  readonly edit: boolean
  /** Submit a cost rule to Finance. */
  readonly submit: boolean
  readonly approve: boolean
  readonly requestChanges: boolean
  /** Finance's single "Approve and publish" gesture on a submitted cost rule. */
  readonly approveAndPublish: boolean
  readonly publish: boolean
}

export function availableActions(
  role: RoleCode | null,
  status: RuleVersionStatus,
  isCostRule: boolean,
): VersionActions {
  const canEdit = hasRulePermission(role, 'rules.edit')
  const canReview = hasRulePermission(role, 'rules.approve_cost')
  const review = canReview && ruleVersionTransition(status, isCostRule, 'approve') !== null
  return {
    edit: canEdit && isRuleVersionEditable(status),
    // Non-cost rules go straight to publishing (the Finance step is skipped).
    submit: canEdit && isCostRule && ruleVersionTransition(status, isCostRule, 'submit') !== null,
    approve: review,
    requestChanges: review && ruleVersionTransition(status, isCostRule, 'request_changes') !== null,
    approveAndPublish: review && hasRulePermission(role, 'rules.publish_cost'),
    publish: canPublishRuleVersion(role, isCostRule, status),
  }
}

/** SCR-061's route for a version of a rule set. */
export function editorPath(ruleSetId: string, versionId: string): string {
  return `/rules/${encodeURIComponent(ruleSetId)}/edit?version=${encodeURIComponent(versionId)}`
}

/** The version SCR-061 shows when the link names none: the open one, else the latest. */
export function defaultVersion(versions: readonly RuleVersionSummary[]): RuleVersionSummary | null {
  return versions.find((v) => (OPEN_RULE_VERSION_STATUSES as readonly string[]).includes(v.status)) ?? versions[0] ?? null
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** Today in the user's own time zone (not UTC: just after midnight in Manila is still "yesterday" in UTC). */
export const localTodayIso = (now: Date = new Date()): string =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
