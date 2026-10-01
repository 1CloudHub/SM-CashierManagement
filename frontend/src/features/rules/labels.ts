/**
 * Display helpers shared by the rule screens: status tone/label and the
 * human label of a payload field path.
 */
import type { RuleVersionStatus } from '@lanewise/shared'
import type { StatusTone } from '@/components/ui'
import type { MessageValues } from '@/i18n'
import { RULE_FIELD_NAMES } from '@/i18n/rules-messages'
import type { LeafPath } from './logic'

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
