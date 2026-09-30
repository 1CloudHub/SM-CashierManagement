/**
 * LaneWise keyboard shortcuts (task 1.9 — design.md "Keyboard shortcuts",
 * UX-003, UX-004, SG-000).
 *
 * A small, discoverable global scheme plus a per-screen registration API:
 *
 *   - KeyboardShortcutsProvider   one window listener + the live registry
 *     useKeyboardShortcuts          engine access (registry, help open state)
 *   - useShortcut / useShortcuts   register shortcuts for a screen/section
 *   - Shortcut / KeyCombo          the shapes registration uses
 *   - isEditableTarget, parseCombo, matchesCombo   the matcher internals
 *   - comboTokens / shortcutChips / shortcutAria   display for the reference
 *
 * Shortcuts are additive (never the only path), never trap focus, are disabled
 * while typing (unless they use ⌘/Ctrl or opt in), and every one is listed in
 * the shortcut reference (SCR-091). The reference itself lives in
 * @/components/help.
 */
export { KeyboardShortcutsProvider } from './keyboard-context'
export {
  useKeyboardShortcuts,
  type KeyboardContextValue,
} from './keyboard-store'
export { useShortcut, useShortcuts } from './use-shortcut'
export {
  comboUsesModifier,
  isApplePlatform,
  isEditableTarget,
  matchesCombo,
  parseCombo,
  type KeyCombo,
  type Shortcut,
} from './keys'
export {
  comboTokens,
  shortcutAria,
  shortcutChips,
} from './key-display'
