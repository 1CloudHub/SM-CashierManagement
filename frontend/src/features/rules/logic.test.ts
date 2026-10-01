import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  COST_RULE_SET_TYPES,
  RULE_VERSION_STATUSES,
  ROLE_CODES,
  canPublishRuleVersion,
} from '@lanewise/shared'
import {
  availableActions,
  defaultVersion,
  editorPath,
  flattenLeaves,
  groupLeaves,
  keyPath,
  parseLeafInput,
  pathKey,
  previousValue,
  setLeaf,
} from './logic'

describe('payload leaves', () => {
  const json = fc.letrec((tie) => ({
    value: fc.oneof(
      { depthSize: 'small' },
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      fc.string(),
      fc.boolean(),
      tie('object'),
      tie('array'),
    ),
    object: fc.dictionary(fc.string({ minLength: 1 }), tie('value'), { maxKeys: 4 }),
    array: fc.array(tie('value'), { maxLength: 3 }),
  }))

  it('setting every leaf to its own value rebuilds the payload', () => {
    fc.assert(
      fc.property(json.object, (payload) => {
        let rebuilt: unknown = payload
        for (const leaf of flattenLeaves(payload)) rebuilt = setLeaf(rebuilt, leaf.path, leaf.value)
        expect(rebuilt).toEqual(payload)
      }),
    )
  })

  it('setLeaf changes only the addressed leaf and never mutates the input', () => {
    fc.assert(
      fc.property(json.object, fc.nat(), fc.integer(), (payload, i, value) => {
        const leaves = flattenLeaves(payload)
        fc.pre(leaves.length > 0)
        const target = leaves[i % leaves.length]!
        const frozen = JSON.stringify(payload)
        const next = setLeaf(payload, target.path, value)
        expect(JSON.stringify(payload)).toBe(frozen)
        for (const leaf of flattenLeaves(next)) {
          const same = leaf.path.length === target.path.length && leaf.path.every((p, k) => p === target.path[k])
          if (same) expect(leaf.value).toBe(value)
        }
      }),
    )
  })

  it('parses numeric input and keeps text for text leaves', () => {
    expect(parseLeafInput(1, '12.5')).toBe(12.5)
    expect(parseLeafInput(1, ' ')).toBe(' ')
    expect(parseLeafInput(1, 'abc')).toBe('abc')
    expect(parseLeafInput('x', '42')).toBe('42')
    expect(parseLeafInput(true, 'false')).toBe(false)
  })
})

describe('available actions (Req 16.3, 16.4)', () => {
  it('match the shared lifecycle and permissions for every role, status and rule kind', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ROLE_CODES, null),
        fc.constantFrom(...RULE_VERSION_STATUSES),
        fc.boolean(),
        (role, status, isCostRule) => {
          const a = availableActions(role, status, isCostRule)
          expect(a.publish).toBe(canPublishRuleVersion(role, isCostRule, status))
          if (a.publish && !isCostRule) expect(role).toBe('RST')
          if (a.edit || a.submit) expect(role).toBe('RST')
          if (a.approve || a.requestChanges) {
            expect(role).toBe('FIN')
            expect(isCostRule && status === 'submitted').toBe(true)
          }
          // Finance's "Approve and publish" is one gesture on a submitted cost rule.
          if (a.approveAndPublish) expect(a.approve).toBe(true)
          if (!isCostRule) expect(a.submit).toBe(false)
        },
      ),
    )
    expect(COST_RULE_SET_TYPES).toContain('wages')
  })
})

describe('SCR-061 routing', () => {
  const v = (id: string, status: (typeof RULE_VERSION_STATUSES)[number]) => ({
    id,
    ruleSetId: 'set',
    version: 1,
    effectiveFrom: '2026-10-01',
    status,
    isCostRule: true,
    updatedAt: '',
  })

  it('links a version of a rule set', () => {
    expect(editorPath('set/1', 'v 2')).toBe('/rules/set%2F1/edit?version=v%202')
  })

  it('opens the open version, else the latest', () => {
    expect(defaultVersion([v('v3', 'submitted'), v('v2', 'published')])?.id).toBe('v3')
    expect(defaultVersion([v('v2', 'published'), v('v1', 'superseded')])?.id).toBe('v2')
    expect(defaultVersion([])).toBeNull()
  })
})

describe('groupLeaves / previousValue / keyPath (SCR-061 rates table)', () => {
  const payload = { hourlyRateByRegion: { NCR: 90, Visayas: 78 }, defaultHourlyRate: 80, employerLoading: 0.14 }
  const isData = (k: string) => !['hourlyRateByRegion', 'defaultHourlyRate', 'employerLoading'].includes(k)

  it('groups a keyed map into one table and keeps other leaves as fields, in order', () => {
    const groups = groupLeaves(flattenLeaves(payload), isData)
    expect(groups.map((g) => (g.kind === 'table' ? `table:${pathKey(g.path)}:${g.rows.length}` : `field:${pathKey(g.leaf.path)}`))).toEqual([
      'table:hourlyRateByRegion:2',
      'field:defaultHourlyRate',
      'field:employerLoading',
    ])
  })

  it('takes "Was" from the diff, the saved value when unchanged, and nothing for added rows or a first version', () => {
    const saved = new Map<string, unknown>([
      ['hourlyRateByRegion.NCR', 90],
      ['hourlyRateByRegion.Visayas', 78],
    ])
    const diff = {
      fromVersionId: 'v1',
      toVersionId: 'v2',
      changes: [
        { path: ['hourlyRateByRegion', 'NCR'], kind: 'changed' as const, before: 87, after: 90 },
        { path: ['hourlyRateByRegion', 'Mindanao'], kind: 'added' as const, after: 70 },
      ],
    }
    expect(previousValue(diff, saved, ['hourlyRateByRegion', 'NCR'])).toEqual({ present: true, value: 87 })
    expect(previousValue(diff, saved, ['hourlyRateByRegion', 'Visayas'])).toEqual({ present: true, value: 78 })
    expect(previousValue(diff, saved, ['hourlyRateByRegion', 'Mindanao'])).toEqual({ present: false })
    expect(previousValue({ ...diff, fromVersionId: null }, saved, ['hourlyRateByRegion', 'NCR'])).toEqual({ present: false })
  })

  it('turns an error key back into a path with list indexes as numbers', () => {
    expect(keyPath('milestones.0.name')).toEqual(['milestones', 0, 'name'])
    expect(keyPath('')).toEqual([])
  })
})
