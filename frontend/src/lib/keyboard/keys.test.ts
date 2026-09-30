import { describe, expect, it } from 'vitest'
import {
  comboUsesModifier,
  isEditableTarget,
  matchesCombo,
  parseCombo,
} from './keys'

/**
 * Unit tests for the framework-agnostic shortcut core (task 1.9). These lock in
 * the two design rules that must not regress: plain-key shortcuts are disabled
 * while typing, and matching is exact on modifiers.
 */

function keyEvent(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return new KeyboardEvent('keydown', init)
}

describe('parseCombo', () => {
  it('parses a plain key, lower-casing single chars', () => {
    expect(parseCombo('K')).toEqual({ key: 'k' })
    expect(parseCombo('/')).toEqual({ key: '/' })
  })

  it('parses named keys unchanged', () => {
    expect(parseCombo('Escape')).toEqual({ key: 'Escape' })
  })

  it('parses explicit modifiers', () => {
    expect(parseCombo('shift+/')).toEqual({ key: '/', shift: true })
    expect(parseCombo('ctrl+k')).toEqual({ key: 'k', ctrl: true })
    expect(parseCombo('alt+n')).toEqual({ key: 'n', alt: true })
  })

  it('resolves "mod" per platform', () => {
    // The default jsdom navigator is not Apple → mod is Ctrl.
    expect(parseCombo('mod+k')).toEqual({ key: 'k', ctrl: true })
  })
})

describe('matchesCombo', () => {
  it('matches a plain key only when no modifiers are held', () => {
    expect(matchesCombo(keyEvent({ key: '/' }), parseCombo('/'))).toBe(true)
    expect(
      matchesCombo(keyEvent({ key: '/', metaKey: true }), parseCombo('/')),
    ).toBe(false)
  })

  it('requires the exact modifier set', () => {
    const combo = parseCombo('ctrl+k')
    expect(matchesCombo(keyEvent({ key: 'k', ctrlKey: true }), combo)).toBe(true)
    expect(matchesCombo(keyEvent({ key: 'k' }), combo)).toBe(false)
    expect(
      matchesCombo(keyEvent({ key: 'k', ctrlKey: true, shiftKey: true }), combo),
    ).toBe(false)
  })

  it('is case-insensitive on the main key', () => {
    expect(matchesCombo(keyEvent({ key: 'K' }), parseCombo('k'))).toBe(true)
  })
})

describe('comboUsesModifier', () => {
  it('is true for meta/ctrl/alt, false for plain and shift-only', () => {
    expect(comboUsesModifier(parseCombo('mod+k'))).toBe(true)
    expect(comboUsesModifier(parseCombo('alt+n'))).toBe(true)
    expect(comboUsesModifier(parseCombo('/'))).toBe(false)
    // shift alone is not a command modifier — a shifted char is still "typing".
    expect(comboUsesModifier(parseCombo('shift+/'))).toBe(false)
  })
})

describe('isEditableTarget', () => {
  it('treats text inputs, textareas, selects and contenteditable as typing', () => {
    const input = document.createElement('input')
    input.type = 'text'
    expect(isEditableTarget(input)).toBe(true)

    const search = document.createElement('input')
    search.type = 'search'
    expect(isEditableTarget(search)).toBe(true)

    expect(isEditableTarget(document.createElement('textarea'))).toBe(true)
    expect(isEditableTarget(document.createElement('select'))).toBe(true)

    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    // jsdom does not compute isContentEditable from the attribute; assert via a
    // stubbed element instead.
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    expect(isEditableTarget(editable)).toBe(true)
  })

  it('does not treat buttons, checkboxes or plain elements as typing', () => {
    const button = document.createElement('input')
    button.type = 'button'
    expect(isEditableTarget(button)).toBe(false)

    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    expect(isEditableTarget(checkbox)).toBe(false)

    expect(isEditableTarget(document.createElement('button'))).toBe(false)
    expect(isEditableTarget(document.createElement('div'))).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
  })
})
