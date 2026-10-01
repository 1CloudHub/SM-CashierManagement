/**
 * Pure presentation helpers shared by SCR-050 and SCR-051: API error -> copy,
 * plural selection, dataset/run status -> tone + message, ISO-date handling.
 */
import type { DatasetSummary, IngestionRunDto, IngestionStatus } from '@lanewise/shared'
import type { StatusTone } from '@/components/ui'
import type { MessageValues } from '@/i18n'
import { isApiRequestError } from './api'

type T = (id: string, values?: MessageValues) => string

/** Error codes with their own copy; everything else is `data.error.generic`. */
const ERROR_KEY: Record<string, string> = {
  forbidden: 'data.error.forbidden',
  conflict: 'data.error.conflict',
  validation_failed: 'data.error.validation',
  service_unavailable: 'data.error.unavailable',
  network_error: 'data.error.network',
  unauthenticated: 'data.error.unauthenticated',
  payload_too_large: 'data.error.tooLarge',
  unsupported_media_type: 'data.error.notCsv',
  not_found: 'data.error.notFound',
}

export interface ErrorCopy {
  readonly message: string
  readonly requestId: string | null
  readonly code: string | null
}

/**
 * Localised copy for a failed request. `overrides` replaces the message key
 * for specific codes (e.g. a 409 on load has its own explanation).
 */
export function errorCopy(t: T, err: unknown, overrides: Record<string, string> = {}, values?: MessageValues): ErrorCopy {
  if (!isApiRequestError(err)) return { message: t('data.error.generic'), requestId: null, code: null }
  const key = overrides[err.code] ?? ERROR_KEY[err.code] ?? 'data.error.generic'
  return { message: t(key, values), requestId: err.requestId, code: err.code }
}

/** Picks `<base>.one` or `<base>.other` and interpolates `{count}`. */
export function plural(t: T, base: string, count: number, values: MessageValues = {}): string {
  return t(`${base}.${count === 1 ? 'one' : 'other'}`, { ...values, count })
}

export interface StatusCopy {
  readonly tone: StatusTone
  readonly key: string
}

const RUN_STATUS: Record<IngestionStatus, StatusCopy> = {
  validating: { tone: 'info', key: 'data.run.validating' },
  validated: { tone: 'info', key: 'data.run.validated' },
  blocked: { tone: 'danger', key: 'data.run.blocked' },
  loaded: { tone: 'success', key: 'data.run.loaded' },
  failed: { tone: 'danger', key: 'data.run.failed' },
  cancelled: { tone: 'neutral', key: 'data.run.cancelled' },
}

export function runStatus(run: Pick<IngestionRunDto, 'status'>): StatusCopy {
  return RUN_STATUS[run.status]
}

/**
 * The SCR-050 status of a dataset: not loaded, OK, awaiting load (a validated
 * upload not yet loaded) or last upload rejected (the prior data stays active).
 */
export function datasetStatus(summary: DatasetSummary): StatusCopy {
  const last = summary.lastRun
  const lastIsNewer = last && (!summary.current || last.startedAt > summary.current.loadedAt)
  if (lastIsNewer && (last.status === 'validating' || last.status === 'validated')) {
    return { tone: 'info', key: 'data.status.pending' }
  }
  if (!summary.current) return { tone: 'neutral', key: 'data.status.notLoaded' }
  if (lastIsNewer && (last.status === 'blocked' || last.status === 'failed')) {
    return { tone: 'warning', key: 'data.status.rejected' }
  }
  return { tone: 'success', key: 'data.status.ok' }
}

/** Formatting options for an `IsoDate` (a calendar date, no time zone shift). */
export const ISO_DATE_OPTIONS: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeZone: 'UTC' }

/** `YYYY-MM-DD` -> a Date at UTC midnight (format with `ISO_DATE_OPTIONS`). */
export function isoDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`)
}
