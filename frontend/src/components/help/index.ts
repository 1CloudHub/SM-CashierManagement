/**
 * LaneWise help + shortcuts (task 1.9 — SCR-091, UX-003, UX-004, SG-000).
 *
 * The Help and shortcuts screen and its supporting pieces, built on the
 * keyboard engine (@/lib/keyboard) and the Dialog primitive:
 *
 *   - HelpProvider        app-root wiring: KeyboardShortcutsProvider + the
 *                         global scheme (`/`·⌘K, `?`, `g`+key, `n`) + HelpDialog
 *   - HelpDialog          the SCR-091 panel (shortcut reference + "How it works"
 *                         + methodology/support links)
 *   - HelpButton          top-bar / user-menu affordance that opens SCR-091
 *   - ShortcutReference   the live, grouped list of registered shortcuts
 *   - Kbd / ShortcutKeys  key-cap chips for the reference
 *   - InfoPopover         accessible field-level info (never tooltip-only)
 *
 * The shortcut engine and per-screen registration API live in @/lib/keyboard.
 */
export {
  HelpProvider,
  type GlobalShortcutActions,
} from './help-provider'
export { HelpDialog } from './help-dialog'
export { HelpButton } from './help-button'
export { ShortcutReference } from './shortcut-reference'
export { Kbd, ShortcutKeys } from './kbd'
export { InfoPopover } from './info-popover'
