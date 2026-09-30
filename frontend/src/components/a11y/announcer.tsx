import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

/**
 * Live-region announcer (UX-004, design.md: "Live regions announce async
 * results — aria-live=polite for success, assertive for errors").
 *
 * A single pair of visually-hidden live regions mounted once near the app root,
 * plus `useAnnouncer()` to push messages into them from anywhere. Use it for
 * in-page async results that do NOT already surface a toast — filter/result
 * counts ("12 stores match"), autosave state ("Draft saved"), background loads
 * finishing, sort changes, route titles. Toasts self-announce (task 1.4), so
 * don't double-announce those.
 *
 * Politeness follows the standard:
 *   - 'polite'    (aria-live="polite", role="status")  — success + neutral
 *                 results; waits for a pause in speech. This is the default.
 *   - 'assertive' (aria-live="assertive", role="alert") — errors; interrupts.
 *
 * The regions render nothing visible (the `sr-only` utility) and carry no
 * motion. Messages should already be localised (task 1.8) before they reach
 * `announce()`. Each message is stored with a monotonically-increasing `seq`
 * used as the text node's React key, so announcing the same string twice still
 * re-inserts the node and screen readers re-read it.
 */

export type Politeness = 'polite' | 'assertive'

interface Message {
  text: string
  seq: number
}

const EMPTY: Message = { text: '', seq: 0 }

interface AnnouncerContextValue {
  announce: (message: string, politeness?: Politeness) => void
}

const AnnouncerContext = createContext<AnnouncerContextValue | null>(null)

export function AnnouncerProvider({ children }: { children: React.ReactNode }) {
  const [polite, setPolite] = useState<Message>(EMPTY)
  const [assertive, setAssertive] = useState<Message>(EMPTY)
  const seq = useRef(0)

  const announce = useCallback(
    (message: string, politeness: Politeness = 'polite') => {
      if (!message) return
      seq.current += 1
      const next = { text: message, seq: seq.current }
      if (politeness === 'assertive') {
        setAssertive(next)
      } else {
        setPolite(next)
      }
    },
    [],
  )

  const value = useMemo(() => ({ announce }), [announce])

  return (
    <AnnouncerContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        <span key={polite.seq}>{polite.text}</span>
      </div>
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      >
        <span key={assertive.seq}>{assertive.text}</span>
      </div>
    </AnnouncerContext.Provider>
  )
}

/**
 * Access the announcer. Must be used within an <AnnouncerProvider> (mounted by
 * the app root). Returns `announce(message, politeness?)`.
 */
export function useAnnouncer(): AnnouncerContextValue {
  const ctx = useContext(AnnouncerContext)
  if (!ctx) {
    throw new Error('useAnnouncer must be used within an AnnouncerProvider')
  }
  return ctx
}

/**
 * Announce a message once whenever it changes (e.g. a result count derived from
 * state). Skips the initial empty/undefined value so nothing is announced on
 * first mount. Convenience wrapper over useAnnouncer for the common "announce
 * this derived string when it updates" case.
 */
export function useAnnounce(
  message: string | undefined,
  politeness: Politeness = 'polite',
): void {
  const { announce } = useAnnouncer()
  const previous = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (message && message !== previous.current) {
      announce(message, politeness)
    }
    previous.current = message
  }, [message, politeness, announce])
}
