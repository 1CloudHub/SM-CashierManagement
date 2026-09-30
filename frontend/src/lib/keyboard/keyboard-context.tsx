import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  comboUsesModifier,
  isEditableTarget,
  matchesCombo,
  parseCombo,
  type Shortcut,
} from './keys'
import {
  KeyboardContext,
  type KeyboardContextValue,
} from './keyboard-store'

/**
 * Global keyboard-shortcut engine (task 1.9 — design.md "Keyboard shortcuts",
 * UX-003, UX-004, SG-000).
 *
 * `KeyboardShortcutsProvider` mounts ONE window keydown listener and holds the
 * live registry of shortcuts. Screens and components register/unregister their
 * shortcuts through `useShortcut` / `useShortcuts` (see ./use-shortcut), which
 * call `register` here. The provider:
 *
 *   - Skips plain-key shortcuts while the user is typing (design rule 1). A
 *     combo that uses ⌘/Ctrl/Alt still fires (so ⌘K works from a search box),
 *     and a shortcut may opt in with `allowInInput` (Esc does, so dialogs close
 *     from a focused field).
 *   - Handles the `g`+key sequences with a short-lived leader buffer that
 *     clears on timeout, on a non-matching key, or on blur — so a stray `g`
 *     never sticks.
 *   - Never moves focus itself and never blocks the browser: it only calls a
 *     shortcut's `run`, which decides whether to `preventDefault`.
 *
 * Registration is last-wins per id + scope: two shortcuts with the same id in
 * the same scope would collide, so ids are unique within a scope (dev warning).
 * The `?` help shortcut and the help-open state live here too so any surface
 * can open the reference and the reference can read the current registry.
 *
 * The context object + `useKeyboardShortcuts` hook live in ./keyboard-store so
 * this file exports only the provider component (React Fast Refresh).
 */

/** How long a sequence leader (e.g. `g`) stays armed before it clears. */
const SEQUENCE_TIMEOUT_MS = 1200

interface RegisteredShortcut extends Shortcut {
  /** Registration order, so listing is stable and deterministic. */
  order: number
}

export function KeyboardShortcutsProvider({
  children,
}: {
  children: React.ReactNode
}) {
  // A ref holds the registry for the (stable) event handler; a state mirror
  // drives the help reference re-render. Both update together.
  const registryRef = useRef<Map<string, RegisteredShortcut>>(new Map())
  const orderRef = useRef(0)
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([])
  const [helpOpen, setHelpOpen] = useState(false)

  const syncList = useCallback(() => {
    const list = [...registryRef.current.values()].sort(
      (a, b) => a.order - b.order,
    )
    setShortcuts(list)
  }, [])

  const register = useCallback(
    (shortcut: Shortcut) => {
      if (shortcut.enabled === false) return () => {}
      if (import.meta.env?.DEV && registryRef.current.has(shortcut.id)) {
        console.warn(
          `KeyboardShortcuts: duplicate shortcut id "${shortcut.id}" — the ` +
            'later registration wins. Ids must be unique.',
        )
      }
      orderRef.current += 1
      registryRef.current.set(shortcut.id, {
        ...shortcut,
        order: orderRef.current,
      })
      syncList()
      return () => {
        registryRef.current.delete(shortcut.id)
        syncList()
      }
    },
    [syncList],
  )

  // Sequence leader buffer (e.g. `g`), armed for a short window.
  const leaderRef = useRef<string | null>(null)
  const leaderTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearLeader = useCallback(() => {
    leaderRef.current = null
    if (leaderTimer.current) {
      clearTimeout(leaderTimer.current)
      leaderTimer.current = null
    }
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Never interfere with an in-progress IME composition.
      if (event.isComposing) return

      const typing = isEditableTarget(event.target)
      const list = [...registryRef.current.values()]

      // 1) If a sequence leader is armed, try to complete it first.
      if (leaderRef.current) {
        const leader = leaderRef.current
        const key =
          event.key.length === 1 ? event.key.toLowerCase() : event.key
        const match = list.find(
          (s) =>
            s.sequence && s.sequence[0] === leader && s.sequence[1] === key,
        )
        clearLeader()
        if (match) {
          event.preventDefault()
          match.run(event)
          return
        }
        // Fall through: the key may itself start a new combo/leader.
      }

      // 2) Single-combo shortcuts.
      for (const s of list) {
        if (!s.keys) continue
        for (const spec of s.keys) {
          const combo = parseCombo(spec)
          if (!matchesCombo(event, combo)) continue
          // Disabled while typing unless it uses a modifier or opts in.
          if (typing && !comboUsesModifier(combo) && !s.allowInInput) continue
          s.run(event)
          return
        }
      }

      // 3) Arm a sequence leader if a plain key starts one (never while typing).
      if (!typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const key =
          event.key.length === 1 ? event.key.toLowerCase() : event.key
        const startsSequence = list.some(
          (s) => s.sequence && s.sequence[0] === key,
        )
        if (startsSequence) {
          event.preventDefault()
          leaderRef.current = key
          if (leaderTimer.current) clearTimeout(leaderTimer.current)
          leaderTimer.current = setTimeout(clearLeader, SEQUENCE_TIMEOUT_MS)
        }
      }
    }

    // A stray leader must not persist across focus loss.
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', clearLeader)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', clearLeader)
      clearLeader()
    }
  }, [clearLeader])

  const value = useMemo<KeyboardContextValue>(
    () => ({ register, shortcuts, helpOpen, setHelpOpen }),
    [register, shortcuts, helpOpen],
  )

  return (
    <KeyboardContext.Provider value={value}>
      {children}
    </KeyboardContext.Provider>
  )
}
