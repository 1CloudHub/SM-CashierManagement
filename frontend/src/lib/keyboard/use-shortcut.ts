import { useEffect, useRef } from 'react'
import { useKeyboardShortcuts } from './keyboard-store'
import type { Shortcut } from './keys'

/**
 * Per-screen shortcut registration API (task 1.9).
 *
 * `useShortcut` registers a single shortcut for the lifetime of the calling
 * component; `useShortcuts` registers a list. Both unregister automatically on
 * unmount, so a shortcut is only live while its screen/section is mounted —
 * this is how "context shortcuts on the roster timeline" scope to that screen
 * without leaking into the rest of the app.
 *
 * The latest `run` handler is always used even though registration is not
 * re-run on every render: the shortcut object is kept in a ref (updated in an
 * effect, never during render) and the engine calls through it, so closures
 * stay fresh without churning the registry. Pass `enabled: false` to withhold a
 * shortcut (e.g. a bulk action with no selection) — it is simply not registered
 * while disabled.
 *
 * Because these shortcuts are additive, the component must still expose the
 * same action through a real control (button/menu item); the shortcut is a
 * fast path, never the only path (design rule 2).
 */
export function useShortcut(shortcut: Shortcut): void {
  const { register } = useKeyboardShortcuts()
  const ref = useRef(shortcut)

  // Keep the ref fresh in an effect (not during render) so the registered
  // wrapper always calls the latest handler.
  useEffect(() => {
    ref.current = shortcut
  })

  const enabled = shortcut.enabled !== false
  // Re-register only when identity/keys/enabled change, not on every render.
  const key = registrationKey(shortcut)

  useEffect(() => {
    if (!enabled) return
    // Register a thin wrapper that always calls the latest handler.
    return register({
      ...ref.current,
      run: (event) => ref.current.run(event),
    })
  }, [register, key, enabled])
}

/**
 * Register several shortcuts at once. The list identity does not need to be
 * stable; registration re-runs when the set of ids/keys/enabled changes.
 */
export function useShortcuts(shortcuts: Shortcut[]): void {
  const { register } = useKeyboardShortcuts()
  const ref = useRef(shortcuts)

  useEffect(() => {
    ref.current = shortcuts
  })

  const key = shortcuts.map(registrationKey).join('|')

  useEffect(() => {
    const unregisters = ref.current
      .filter((s) => s.enabled !== false)
      .map((s) =>
        register({ ...s, run: (event) => runById(ref.current, s.id, event) }),
      )
    return () => unregisters.forEach((u) => u())
  }, [register, key])
}

function runById(list: Shortcut[], id: string, event: KeyboardEvent): void {
  const current = list.find((s) => s.id === id)
  current?.run(event)
}

function registrationKey(s: Shortcut): string {
  const keys = s.keys?.join(',') ?? ''
  const seq = s.sequence ? s.sequence.join('>') : ''
  return `${s.id}:${keys}:${seq}:${s.enabled === false ? '0' : '1'}`
}
