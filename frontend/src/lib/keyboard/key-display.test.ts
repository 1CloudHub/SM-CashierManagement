import { describe, expect, it } from 'vitest'
import { comboTokens, shortcutAria, shortcutChips } from './key-display'

/**
 * Display-string tests for the shortcut reference (task 1.9). Display is
 * platform-aware and glyph-based but must never affect matching.
 */

describe('comboTokens', () => {
  it('renders mod as ⌘ on Apple and Ctrl elsewhere', () => {
    expect(comboTokens('mod+k', true)).toEqual(['⌘', 'K'])
    expect(comboTokens('mod+k', false)).toEqual(['Ctrl', 'K'])
  })

  it('orders modifiers before the main key', () => {
    expect(comboTokens('shift+/', true)).toEqual(['⇧', '/'])
  })

  it('maps named keys to compact glyphs', () => {
    expect(comboTokens('Escape', true)).toEqual(['Esc'])
    expect(comboTokens('Enter', true)).toEqual(['↵'])
    expect(comboTokens('ArrowUp', true)).toEqual(['↑'])
  })

  it('upper-cases single printable keys', () => {
    expect(comboTokens('n', false)).toEqual(['N'])
    expect(comboTokens('?', false)).toEqual(['?'])
  })
})

describe('shortcutChips', () => {
  it('returns one chip pressed together for a combo', () => {
    const result = shortcutChips({ keys: ['mod+k'] }, true)
    expect(result.sequence).toBe(false)
    expect(result.chips).toEqual([['⌘', 'K']])
  })

  it('returns two ordered chips for a sequence', () => {
    const result = shortcutChips({ sequence: ['g', 'h'] }, false)
    expect(result.sequence).toBe(true)
    expect(result.chips).toEqual([['G'], ['H']])
  })

  it('returns no chips when a shortcut has neither keys nor sequence', () => {
    expect(shortcutChips({}, false)).toEqual({ chips: [], sequence: false })
  })
})

describe('shortcutAria', () => {
  it('joins a combo with spaces', () => {
    expect(shortcutAria({ keys: ['mod+k'] }, 'then', true)).toBe('⌘ K')
  })

  it('joins a sequence with the localised connector', () => {
    expect(shortcutAria({ sequence: ['g', 'h'] }, 'then', false)).toBe(
      'G then H',
    )
    expect(shortcutAria({ sequence: ['g', 'r'] }, 'tapos', false)).toBe(
      'G tapos R',
    )
  })
})
