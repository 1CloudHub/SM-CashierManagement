/**
 * Pure helpers for the rule screens (SCR-060/061): walking and editing rule
 * payloads as leaf fields, and deciding which actions the active role may take
 * on a version (Req 16.3, 16.4). The server re-checks everything (P12).
 */
import {
  canPublishRuleVersion,
  hasRulePermission,
  isRuleVersionEditable,
  ruleVersionTransition,
  type RoleCode,
  type RuleVersionStatus,
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
