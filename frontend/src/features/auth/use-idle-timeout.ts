import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_IDLE_POLICY,
  idlePhase,
  msUntilNextPhase,
  msUntilTimeout,
  readLastActivity,
  writeLastActivity,
  type IdlePhase,
  type IdlePolicy,
} from './idle'

/** DOM events that count as activity. */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const

/** Persist activity at most this often (keeps localStorage writes cheap). */
const ACTIVITY_WRITE_THROTTLE_MS = 5_000

export interface UseIdleTimeoutOptions {
  readonly enabled?: boolean
  readonly policy?: IdlePolicy
  readonly onTimeout: () => void
  readonly now?: () => number
}

export interface IdleTimeoutState {
  readonly phase: IdlePhase
  /** Milliseconds left before sign-out. */
  readonly msLeft: number
  /** "Stay signed in": resets the idle clock (all tabs). */
  staySignedIn: () => void
}

/**
 * Tracks user activity and drives the 60-minute idle timeout with a 2-minute
 * warning (requirement 1.8). While the warning shows, passive activity does
 * not dismiss it — the user must choose "Stay signed in", so the choice is
 * explicit and announced.
 */
export function useIdleTimeout({
  enabled = true,
  policy = DEFAULT_IDLE_POLICY,
  onTimeout,
  now = Date.now,
}: UseIdleTimeoutOptions): IdleTimeoutState {
  const [phase, setPhase] = useState<IdlePhase>('active')
  const [msLeft, setMsLeft] = useState(policy.timeoutMs)
  const phaseRef = useRef<IdlePhase>('active')
  const onTimeoutRef = useRef(onTimeout)
  const nowRef = useRef(now)
  const wakeRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    onTimeoutRef.current = onTimeout
    nowRef.current = now
  }, [onTimeout, now])

  // Record activity (only while not warning).
  useEffect(() => {
    if (!enabled) return
    if (readLastActivity() === null) writeLastActivity(nowRef.current())
    let lastWrite = 0
    const onActivity = () => {
      if (phaseRef.current !== 'active') return
      const t = nowRef.current()
      if (t - lastWrite < ACTIVITY_WRITE_THROTTLE_MS) return
      lastWrite = t
      writeLastActivity(t)
    }
    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, onActivity, { passive: true, capture: true })
    return () => {
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, onActivity, { capture: true })
    }
  }, [enabled])

  // Evaluate the phase at each boundary (every second during the warning).
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let done = false
    const tick = () => {
      if (done) return
      const t = nowRef.current()
      const last = readLastActivity() ?? t
      const next = idlePhase(t, last, policy)
      phaseRef.current = next
      setPhase(next)
      setMsLeft(msUntilTimeout(t, last, policy))
      if (next === 'expired') {
        done = true
        onTimeoutRef.current()
        return
      }
      const untilNext = msUntilNextPhase(t, last, policy)
      const delay = next === 'warning' ? Math.min(1_000, untilNext) : untilNext
      timer = setTimeout(tick, Math.max(delay, 25))
    }
    wakeRef.current = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(tick, 0)
    }
    timer = setTimeout(tick, 0)
    return () => {
      done = true
      if (timer) clearTimeout(timer)
      wakeRef.current = () => undefined
    }
  }, [enabled, policy])

  const staySignedIn = useCallback(() => {
    writeLastActivity(nowRef.current())
    phaseRef.current = 'active'
    setPhase('active')
    wakeRef.current()
  }, [])

  return { phase, msLeft, staySignedIn }
}
