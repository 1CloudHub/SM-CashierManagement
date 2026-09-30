import { useCallback } from 'react'
import {
  KeyboardShortcutsProvider,
  useKeyboardShortcuts,
  useShortcuts,
  type Shortcut,
} from '@/lib/keyboard'
import { HelpDialog } from './help-dialog'

/**
 * HelpProvider (task 1.9) — the app-root wiring for the global keyboard scheme
 * and the Help/shortcuts screen (SCR-091).
 *
 * Wrap the signed-in app in this (inside I18nProvider so descriptions localise,
 * and typically inside AnnouncerProvider). It:
 *   1. mounts the KeyboardShortcutsProvider (the single window listener +
 *      registry),
 *   2. registers the global scheme — `/` or ⌘K search, `?` the shortcut
 *      reference, `g`+key navigation, `n` notifications, Esc close — as
 *      real, listed shortcuts, and
 *   3. mounts the HelpDialog once.
 *
 * Actions are passed in as callbacks so the shell decides what "focus search"
 * or "go to Roster" means (routing, focusing the search box, opening the
 * notifications panel). Any action left undefined is simply not registered, so
 * the reference never lists a shortcut that does nothing. `?` and Esc are
 * always registered because the help dialog is owned here.
 */
export interface GlobalShortcutActions {
  /** Focus the global search (`/` and ⌘K). */
  onFocusSearch?: () => void
  /** Open the notifications panel (`n`). */
  onOpenNotifications?: () => void
  /** Navigate somewhere (`g` then a key). Receives a route key: home|roster|map. */
  onNavigate?: (target: 'home' | 'roster' | 'map') => void
}

export function HelpProvider({
  children,
  methodologyHref,
  supportHref,
  ...actions
}: {
  children: React.ReactNode
  methodologyHref?: string
  supportHref?: string
} & GlobalShortcutActions) {
  return (
    <KeyboardShortcutsProvider>
      <GlobalShortcuts {...actions} />
      {children}
      <HelpDialog
        methodologyHref={methodologyHref}
        supportHref={supportHref}
      />
    </KeyboardShortcutsProvider>
  )
}

/**
 * Registers the global scheme against the engine. Split from the provider so it
 * can call `useKeyboardShortcuts()` (which requires being *inside* the provider)
 * and `useShortcuts()`.
 */
function GlobalShortcuts({
  onFocusSearch,
  onOpenNotifications,
  onNavigate,
}: GlobalShortcutActions) {
  const { setHelpOpen } = useKeyboardShortcuts()

  const openHelp = useCallback(
    (event: KeyboardEvent) => {
      event.preventDefault()
      setHelpOpen(true)
    },
    [setHelpOpen],
  )

  const shortcuts: Shortcut[] = []

  // `?` opens the shortcut reference — always available. `?` is Shift+/ on most
  // layouts; match the produced character so it works regardless of layout.
  shortcuts.push({
    id: 'global.help',
    keys: ['?'],
    groupId: 'shortcut.group.global',
    descriptionId: 'shortcut.help',
    run: openHelp,
  })

  // Esc closes the help dialog when it is the top surface. The Dialog already
  // closes on Esc via Radix; this is a no-op fallback and intentionally NOT
  // registered here to avoid competing with focused surfaces' own Esc handling.

  if (onFocusSearch) {
    shortcuts.push({
      id: 'global.search',
      keys: ['/', 'mod+k'],
      groupId: 'shortcut.group.global',
      descriptionId: 'shortcut.search',
      run: (event) => {
        event.preventDefault()
        onFocusSearch()
      },
    })
  }

  if (onOpenNotifications) {
    shortcuts.push({
      id: 'global.notifications',
      keys: ['n'],
      groupId: 'shortcut.group.global',
      descriptionId: 'shortcut.notifications',
      run: (event) => {
        event.preventDefault()
        onOpenNotifications()
      },
    })
  }

  if (onNavigate) {
    shortcuts.push(
      {
        id: 'nav.home',
        sequence: ['g', 'h'],
        groupId: 'shortcut.group.navigation',
        descriptionId: 'shortcut.goHome',
        run: () => onNavigate('home'),
      },
      {
        id: 'nav.roster',
        sequence: ['g', 'r'],
        groupId: 'shortcut.group.navigation',
        descriptionId: 'shortcut.goRoster',
        run: () => onNavigate('roster'),
      },
      {
        id: 'nav.map',
        sequence: ['g', 'm'],
        groupId: 'shortcut.group.navigation',
        descriptionId: 'shortcut.goMap',
        run: () => onNavigate('map'),
      },
    )
  }

  useShortcuts(shortcuts)

  return null
}
