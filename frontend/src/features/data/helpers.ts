/**
 * Pure presentation helpers shared by SCR-050 and SCR-051: API error -> copy,
 * plural selection, dataset/run status -> tone + message, ISO-date handling.
 */
import {
  DATASET_TYPES,
  type DatasetSummary,
  type DatasetType,
  type IngestionIssue,
  type IngestionRunDto,
  type IngestionStatus,
} from '@lanewise/shared'
import type { StatusTone } from '@/components/ui'
import type { MessageValues } from '@/i18n'
import { isApiRequestError, type ApiRequestErrorCode } from './api'

type T = (id: string, values?: MessageValues) => string

/**
 * API error code -> message key. Typed as an exhaustive `Record` over every
 * `ApiErrorCode` (plus the client-side `network_error`), so adding a code to
 * the shared contract fails the build until it has copy here.
 */
export const ERROR_KEY: Readonly<Record<ApiRequestErrorCode, string>> = {
  bad_request: 'data.error.validation',
  validation_failed: 'data.error.validation',
  unauthenticated: 'data.error.unauthenticated',
  forbidden: 'data.error.forbidden',
  not_found: 'data.error.notFound',
  method_not_allowed: 'data.error.generic',
  conflict: 'data.error.conflict',
  payload_too_large: 'data.error.tooLarge',
  unsupported_media_type: 'data.error.notCsv',
  internal_error: 'data.error.generic',
  service_unavailable: 'data.error.unavailable',
  network_error: 'data.error.network',
}

/** Per-call message keys that replace `ERROR_KEY` for specific codes. */
export type ErrorKeyOverrides = Partial<Record<ApiRequestErrorCode, string>>

export interface ErrorCopy {
  readonly message: string
  readonly requestId: string | null
  readonly code: ApiRequestErrorCode | null
}

/**
 * Localised copy for a failed request. `overrides` replaces the message key
 * for specific codes (e.g. a 409 on load has its own explanation).
 */
export function errorCopy(t: T, err: unknown, overrides: ErrorKeyOverrides = {}, values?: MessageValues): ErrorCopy {
  if (!isApiRequestError(err)) return { message: t('data.error.generic'), requestId: null, code: null }
  const key = overrides[err.code] ?? ERROR_KEY[err.code]
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

const SEVERITY_ORDER: Readonly<Record<IngestionIssue['severity'], number>> = { error: 0, warning: 1 }

/** Errors before warnings; otherwise the server's (row) order is kept (stable sort). */
export function sortIssues(issues: readonly IngestionIssue[]): IngestionIssue[] {
  return [...issues].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}

/** `?dataset=master|staff|pos` (links from SCR-052/053) pre-selects the dataset; anything else is ignored. */
export function datasetFromSearch(search: string): DatasetType | undefined {
  const value = new URLSearchParams(search).get('dataset')
  return (DATASET_TYPES as readonly string[]).includes(value ?? '') ? (value as DatasetType) : undefined
}

