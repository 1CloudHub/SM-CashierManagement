import { API_ERROR_CODES, type IngestionIssue } from '@lanewise/shared'
import { describe, expect, it } from 'vitest'
import { dataEn, dataFil } from '@/i18n/data-messages'
import { ApiRequestError } from './api'
import { ERROR_KEY, errorCopy, sortIssues } from './helpers'

const t = (id: string) => dataEn[id] ?? id

describe('ERROR_KEY', () => {
  it('maps every API error code (and network_error) to a key that exists in en and fil', () => {
    for (const code of [...API_ERROR_CODES, 'network_error'] as const) {
      const key = ERROR_KEY[code]
      expect(dataEn[key], `${code} -> ${key}`).toBeDefined()
      expect(dataFil[key], `${code} -> ${key}`).toBeDefined()
    }
  })

  it('errorCopy uses the map, honours overrides and falls back to generic for non-API errors', () => {
    expect(errorCopy(t, new ApiRequestError('payload_too_large', 413, 'x', 'r1'))).toEqual({
      message: dataEn['data.error.tooLarge'],
      requestId: 'r1',
      code: 'payload_too_large',
    })
    expect(errorCopy(t, new ApiRequestError('conflict', 409, 'x'), { conflict: 'data.error.notFound' }).message).toBe(
      dataEn['data.error.notFound'],
    )
    expect(errorCopy(t, new Error('boom'))).toEqual({ message: dataEn['data.error.generic'], requestId: null, code: null })
  })
})

describe('sortIssues', () => {
  const issue = (row: number, severity: IngestionIssue['severity']): IngestionIssue => ({
    row,
    severity,
    code: 'x',
    message: `${severity} ${row}`,
  })

  it('lists errors before warnings and keeps row order within each severity', () => {
    const sorted = sortIssues([issue(1, 'warning'), issue(2, 'error'), issue(3, 'warning'), issue(4, 'error')])
    expect(sorted.map((i) => i.message)).toEqual(['error 2', 'error 4', 'warning 1', 'warning 3'])
  })
})
