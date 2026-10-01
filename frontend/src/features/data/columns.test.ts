import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DATASET_COLUMNS, DATASET_TYPES, normaliseHeader, type DatasetType } from '@lanewise/shared'
import {
  autoMapColumns,
  isMappingComplete,
  looksLikeCsv,
  mappingProblems,
  parseHeaderRow,
  readHeaderRow,
  toColumnMapping,
} from './columns'
import { datasetStatus, plural } from './helpers'
import { run, snapshot } from '@/test/data'

const datasetType = fc.constantFrom<DatasetType>(...DATASET_TYPES)

/** Headers: canonical names in assorted spellings mixed with junk columns. */
function headersFor(type: DatasetType) {
  const canonical = DATASET_COLUMNS[type].map((c) => c.field)
  const spelled = fc
    .tuple(fc.constantFrom(...canonical), fc.constantFrom('lower', 'upper', 'title', 'spaced'))
    .map(([field, style]) => {
      if (style === 'upper') return field.toUpperCase()
      if (style === 'spaced') return ` ${field.replace(/_/g, ' ')} `
      if (style === 'title') return field.split('_').map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ')
      return field
    })
  return fc.array(fc.oneof(spelled, fc.string({ maxLength: 12 })), { maxLength: 14 })
}

const typeAndHeaders = datasetType.chain((type) => headersFor(type).map((headers) => ({ type, headers })))

describe('autoMapColumns (property)', () => {
  it('maps every field that has an exactly matching normalised header', () => {
    fc.assert(
      fc.property(typeAndHeaders, ({ type, headers }) => {
        const mapping = autoMapColumns(type, headers)
        for (const { field } of DATASET_COLUMNS[type]) {
          const match = headers.some((h) => normaliseHeader(h) === field)
          if (match) expect(normaliseHeader(mapping[field]!)).toBe(field)
        }
      }),
    )
  })

  it('only maps to headers in the file, and never maps one header to two fields', () => {
    fc.assert(
      fc.property(typeAndHeaders, ({ type, headers }) => {
        const mapping = autoMapColumns(type, headers)
        const chosen = Object.values(mapping).filter(Boolean)
        for (const h of chosen) expect(headers).toContain(h)
        expect(new Set(chosen).size).toBe(chosen.length)
        expect(mappingProblems(type, mapping).duplicateHeaders).toEqual([])
      }),
    )
  })

  it('covers exactly the canonical fields of the type', () => {
    fc.assert(
      fc.property(typeAndHeaders, ({ type, headers }) => {
        expect(Object.keys(autoMapColumns(type, headers)).sort()).toEqual(
          DATASET_COLUMNS[type].map((c) => c.field).sort(),
        )
      }),
    )
  })

  it('is complete for a file with every canonical header, and the wire mapping is identity', () => {
    fc.assert(
      fc.property(datasetType, (type) => {
        const headers = DATASET_COLUMNS[type].map((c) => c.field)
        const mapping = autoMapColumns(type, headers)
        expect(isMappingComplete(type, mapping)).toBe(true)
        expect(toColumnMapping(type, mapping)).toEqual(Object.fromEntries(headers.map((h) => [h, h])))
      }),
    )
  })
})

describe('mappingProblems', () => {
  it('lists unmapped required fields and duplicate headers', () => {
    const mapping = { ...autoMapColumns('pos', ['Store Code', 'Date']), hour: 'Date' }
    const problems = mappingProblems('pos', mapping)
    expect(problems.missingRequired).toEqual(['department', 'transactions'])
    expect(problems.duplicateHeaders).toEqual(['Date'])
    expect(toColumnMapping('pos', mapping)).toEqual({ store_code: 'Store Code', date: 'Date', hour: 'Date' })
  })
})

describe('parseHeaderRow', () => {
  it('handles a BOM, quotes, escaped quotes and CRLF', () => {
    expect(parseHeaderRow('﻿Store Code,"Dept, name","Say ""hi""",Date\r\n1,2,3,4')).toEqual([
      'Store Code',
      'Dept, name',
      'Say "hi"',
      'Date',
    ])
  })

  it('drops empty cells and returns [] for an empty file', () => {
    expect(parseHeaderRow('a,,b,\n')).toEqual(['a', 'b'])
    expect(parseHeaderRow('')).toEqual([])
  })

  it('round-trips headers without separators (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.stringMatching(/^[A-Za-z0-9 _]{1,10}$/), { maxLength: 10 }), (cells) => {
        const expected = cells.map((c) => c.trim()).filter(Boolean)
        expect(parseHeaderRow(`${cells.join(',')}\r\nrow`)).toEqual(expected)
      }),
    )
  })

  it('reads the header of a File', async () => {
    const file = new File(['store_code,date\n1,2\n'], 'a.csv', { type: 'text/csv' })
    expect(await readHeaderRow(file)).toEqual(['store_code', 'date'])
  })
})

describe('looksLikeCsv', () => {
  it('accepts .csv names or the text/csv type', () => {
    expect(looksLikeCsv({ name: 'A.CSV', type: '' })).toBe(true)
    expect(looksLikeCsv({ name: 'a', type: 'text/csv' })).toBe(true)
    expect(looksLikeCsv({ name: 'a.xlsx', type: 'application/vnd.ms-excel' })).toBe(false)
  })
})

describe('helpers', () => {
  it('plural picks one/other', () => {
    const t = (id: string, v?: Record<string, string | number>) => `${id}:${v?.count}`
    expect(plural(t, 'x', 1)).toBe('x.one:1')
    expect(plural(t, 'x', 0)).toBe('x.other:0')
    expect(plural(t, 'x', 3)).toBe('x.other:3')
  })

  it('datasetStatus reflects the current snapshot and the latest run', () => {
    const base = { type: 'pos' as const, currentReal: null, currentSynthetic: null }
    expect(datasetStatus({ ...base, current: null, lastRun: null }).key).toBe('data.status.notLoaded')
    expect(datasetStatus({ ...base, current: snapshot(), lastRun: run() }).key).toBe('data.status.ok')
    expect(
      datasetStatus({ ...base, current: snapshot(), lastRun: run({ status: 'blocked', startedAt: '2026-09-29T00:00:00Z' }) }).key,
    ).toBe('data.status.rejected')
    expect(
      datasetStatus({ ...base, current: snapshot(), lastRun: run({ status: 'validated', startedAt: '2026-09-29T00:00:00Z' }) }).key,
    ).toBe('data.status.pending')
  })
})
