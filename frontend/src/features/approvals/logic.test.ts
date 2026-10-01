import { describe, expect, it } from 'vitest'
import { approvalPath, commentSatisfies, scenarioFromSearch } from './logic'

describe('approval helpers', () => {
  it('round-trips the reviewed scenario through the URL', () => {
    expect(approvalPath()).toBe('/approvals')
    expect(approvalPath('scn 1')).toBe('/approvals?scenario=scn%201')
    expect(scenarioFromSearch('?scenario=scn%201')).toBe('scn 1')
    expect(scenarioFromSearch('')).toBeNull()
  })

  it('requires a comment to request changes or reject only', () => {
    expect(commentSatisfies('approve', '')).toBe(true)
    expect(commentSatisfies('request_changes', '  ')).toBe(false)
    expect(commentSatisfies('reject', 'Not this season')).toBe(true)
  })
})
