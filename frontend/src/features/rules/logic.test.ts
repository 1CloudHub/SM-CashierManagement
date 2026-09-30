import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  COST_RULE_SET_TYPES,
  RULE_VERSION_STATUSES,
  ROLE_CODES,
  canPublishRuleVersion,
} from '@lanewise/shared'
import { availableActions, flattenLeaves, parseLeafInput, setLeaf } from './logic'

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
