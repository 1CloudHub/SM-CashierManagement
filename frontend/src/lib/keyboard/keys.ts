/**
 * Keyboard shortcut primitives (task 1.9 — design.md "Keyboard shortcuts",
 * UX-003, UX-004, SG-000).
 *
 * The small, discoverable global scheme LaneWise ships with:
 *   `/` or ⌘K  focus search      `?` open the shortcut reference (SCR-091)
 *   `g` then …  jump to a section  `n` open notifications   Esc close surfaces
 *
 * plus per-screen context shortcuts (e.g. the roster timeline). This module is
 * the framework-agnostic core: the `Shortcut` shape, key-combo parsing and the
 * matcher that decides whether a `KeyboardEvent` fires a shortcut. The React
 * layer (./keyboard-context, ./use-shortcut) registers shortcuts and owns the
 * single window listener.
 *
 * Two rules from the design are enforced here, not per screen:
 *   1. Shortcuts are DISABLED WHILE TYPING — `isEditableTarget` treats inputs,
 *      textareas, selects and contenteditable as typing contexts, so a plain
 *      key like `/` or `?` never fires while the user is entering text. Combos
 *      that use a modifier (⌘K) are still allowed there, matching platform
 *      conventions for command palettes.
 *   2. Shortcuts NEVER TRAP FOCUS and are ADDITIVE — every action they trigger
 *      is also reachable without them; nothing here moves focus on its own.
 */

/** A parsed key combination: a single main key plus required modifiers. */
export interface KeyCombo {
  /** The main key, normalised (single chars lower-cased; e.g. "k", "/", "Escape"). */
  key: string
  /** Requires the platform command/meta modifier (⌘ on macOS, mostly unused elsewhere). */
  meta?: boolean
  /** Requires Ctrl. */
  ctrl?: boolean
  /** Requires Shift. */
  shift?: boolean
  /** Requires Alt/Option. */
  alt?: boolean
}

/**
 * A shortcut binding. `keys` is one or more equivalent combos (e.g. `/` OR ⌘K)
 * written in a compact string form (see `parseCombo`). A `sequence` is a
 * prefix chord like `g h` — the leader key then a following key — used for the
 * `g`+key navigation shortcuts.
 */
export interface Shortcut {
  /** Stable id, unique within its scope (used as the registry key + React key). */
  id: string
  /**
   * Equivalent single-press combos, e.g. `['/', 'mod+k']`. Mutually exclusive
   * with `sequence`. "mod" resolves to ⌘ on macOS and Ctrl elsewhere.
   */
  keys?: string[]
  /**
   * A two-key sequence, e.g. `['g', 'h']` for "g then h". The leader must be a
   * plain key. Sequences never fire while typing.
   */
  sequence?: [leader: string, then: string]
  /** i18n message id for the group this shortcut is listed under in help. */
  groupId: string
  /** i18n message id for the human description shown in the help reference. */
  descriptionId: string
  /** What to run. Receives the originating event so it can preventDefault. */
  run: (event: KeyboardEvent) => void
  /**
   * Allow this shortcut to fire even while the user is typing in an input.
   * Off by default (design rule 1). Esc handling opts in so dialogs still close
   * from a focused field; combos with a modifier are allowed regardless.
   */
  allowInInput?: boolean
  /**
   * When false the shortcut is registered (still listed in help as unavailable
   * is NOT desired) — instead, omit disabled shortcuts from registration.
   * Present for callers that memoise a list; defaults to true.
   */
  enabled?: boolean
}

/** The `mod` token resolves to ⌘ (meta) on Apple platforms, Ctrl elsewhere. */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  // navigator.platform is deprecated but still the most reliable signal in
  // browsers; fall back to userAgent. Both are only read for key display/mapping.
  const p = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`
  return /Mac|iPhone|iPad|iPod/i.test(p)
}

/** Normalise a single key token: single printable chars are lower-cased. */
function normaliseKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key
}

/**
 * Parse a compact combo string into a `KeyCombo`.
 * Grammar: modifiers joined by `+`, main key last. Tokens: `mod`, `meta`/`cmd`,
 * `ctrl`, `shift`, `alt`/`option`. Examples: `"/"`, `"?"`, `"mod+k"`,
 * `"shift+/"`, `"Escape"`.
 */
export function parseCombo(spec: string): KeyCombo {
  const parts = spec.split('+')
  const combo: KeyCombo = { key: '' }
  const apple = isApplePlatform()
  for (const raw of parts) {
    const token = raw.trim()
    const lower = token.toLowerCase()
    switch (lower) {
      case 'mod':
        if (apple) combo.meta = true
        else combo.ctrl = true
        break
      case 'meta':
      case 'cmd':
      case 'command':
        combo.meta = true
        break
      case 'ctrl':
      case 'control':
        combo.ctrl = true
        break
      case 'shift':
        combo.shift = true
        break
      case 'alt':
      case 'option':
        combo.alt = true
        break
      default:
        combo.key = normaliseKey(token)
    }
  }
  return combo
}

/**
 * True when the event target is a place the user is typing, so plain-key
 * shortcuts must not fire (design rule 1). Covers inputs (except non-text
 * button-like inputs), textareas, selects, contenteditable and anything inside
 * a contenteditable host.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type
    // Non-typing input types (button/checkbox/radio…) are safe; text-like ones
    // are typing contexts.
    const nonTyping = new Set([
      'button',
      'checkbox',
      'color',
      'file',
      'image',
      'radio',
      'range',
      'reset',
      'submit',
    ])
    return !nonTyping.has(type)
  }
  return false
}

/** Does a `KeyboardEvent` satisfy this parsed combo? */
export function matchesCombo(event: KeyboardEvent, combo: KeyCombo): boolean {
  if (normaliseKey(event.key) !== combo.key) return false
  return (
    event.metaKey === !!combo.meta &&
    event.ctrlKey === !!combo.ctrl &&
    event.altKey === !!combo.alt &&
    event.shiftKey === !!combo.shift
  )
}

/** A combo uses a command modifier (⌘/Ctrl) — allowed even while typing. */
export function comboUsesModifier(combo: KeyCombo): boolean {
  return !!(combo.meta || combo.ctrl || combo.alt)
}
