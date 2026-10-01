/**
 * Display helpers shared by the rule screens: status tone/label and the
 * human label of a payload field path.
 */
import { isIsoDate, type RuleVersionStatus } from '@lanewise/shared'
import type { StatusTone } from '@/components/ui'
import type { MessageValues } from '@/i18n'
import { RULE_FIELD_NAMES } from '@/i18n/rules-messages'
import { flattenLeaves, type LeafPath } from './logic'

type T = (id: string, values?: MessageValues) => string

export const STATUS_TONE: Record<RuleVersionStatus, StatusTone> = {
  draft: 'neutral',
  submitted: 'info',
  changes_requested: 'warning',
  approved: 'success',
  published: 'success',
  superseded: 'neutral',
}

export const statusLabel = (t: T, status: RuleVersionStatus): string => t(`rules.status.${status}`)

const KNOWN = new Set<string>(RULE_FIELD_NAMES)

/** True for payload keys that are data (a region), not a named rule field. */
export const isDataKey = (key: string): boolean => !KNOWN.has(key)

/**
 * "Base rate by region (₱/h) › NCR", "Milestones › #2 › Name". Known field
 * names are translated; data keys (regions, …) are shown as they are.
 */
export function fieldLabel(t: T, path: LeafPath): string {
  return path
    .map((seg) =>
      typeof seg === 'number'
        ? t('rules.editor.itemNumber', { n: seg + 1 })
        : KNOWN.has(seg)
          ? t(`rules.field.${seg}`)
          : seg,
    )
    .join(' › ')
}

/** Rule dates are calendar dates (YYYY-MM-DD); format them without a time-zone shift. */
export const CALENDAR_DATE: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeZone: 'UTC' }

export interface ValueFormatters {
  readonly t: T
  readonly formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string
  readonly formatDate: (value: string, options?: Intl.DateTimeFormatOptions) => string
}

/**
 * A rule value for display: yes/no for flags, locale numbers, calendar dates,
 * and nested values as "Field: value" pairs (never raw JSON).
 */
export function formatRuleValue(f: ValueFormatters, value: unknown): string {
  if (value === null || value === undefined || value === '') return f.t('rules.editor.diff.absent')
  if (typeof value === 'boolean') return f.t(value ? 'rules.list.yes' : 'rules.list.no')
  if (typeof value === 'number') return f.formatNumber(value, { maximumFractionDigits: 4 })
  if (typeof value === 'string') return isIsoDate(value) ? f.formatDate(value, CALENDAR_DATE) : value
  return flattenLeaves(value)
    .map((leaf) =>
      leaf.path.length > 0 ? `${fieldLabel(f.t, leaf.path)}: ${formatRuleValue(f, leaf.value)}` : formatRuleValue(f, leaf.value),
    )
    .join('; ')
}
