import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { AuthClient, AuthUser, CodeDelivery } from './auth-client'
import { clearLastActivity, idlePhase, readLastActivity, writeLastActivity } from './idle'
import { rememberReturnTo } from './return-to'

/**
 * Auth state for the SPA (task 7, requirement 1).
 *
 *   loading      → resolving stored tokens
 *   signedOut    → SCR-001 / SCR-002
 *   needsPasskey → signed in with an email code but no passkey registered on
 *                  this device yet: the app stays locked on SCR-002 step 2
 *                  (the email code is only for passkey setup, requirement 1.5)
 *   signedIn     → the app
 *
 * The "needs passkey" marker is kept in localStorage (shared by every tab, like
 * the tokens), so opening a new tab or reloading can't skip passkey setup.
 */
export type AuthStatus = 'loading' | 'signedOut' | 'needsPasskey' | 'signedIn'
export type SignOutReason = 'expired' | 'signedOut'

export interface AuthContextValue {
  readonly status: AuthStatus
  readonly user: AuthUser | null
  readonly client: AuthClient
  /** Why the user was last signed out in this tab (drives the SCR-001 notice). */
  readonly signOutReason: SignOutReason | null
  /** Email carried from SCR-001 to SCR-002. */
  readonly pendingEmail: string
  setPendingEmail: (email: string) => void
  signInWithPasskey: (email: string) => Promise<void>
  startEmailCode: (email: string) => Promise<CodeDelivery>
  resendEmailCode: () => Promise<CodeDelivery>
  confirmEmailCode: (code: string) => Promise<void>
  registerPasskey: () => Promise<void>
  signOut: (reason?: SignOutReason) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const PASSKEY_PENDING_KEY = 'lw.auth.passkeyPending'

function readPasskeyPending(): string | null {
  try {
    return window.localStorage.getItem(PASSKEY_PENDING_KEY)
  } catch {
    return null
  }
}

function writePasskeyPending(userId: string | null): void {
  try {
    if (userId) window.localStorage.setItem(PASSKEY_PENDING_KEY, userId)
    else window.localStorage.removeItem(PASSKEY_PENDING_KEY)
  } catch {
    // ignore — the in-memory status still gates this tab
  }
}

export function AuthProvider({
  client,
  children,
  now = Date.now,
}: {
  client: AuthClient
  children: ReactNode
  now?: () => number
}) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [signOutReason, setSignOutReason] = useState<SignOutReason | null>(null)
  const [pendingEmail, setPendingEmail] = useState('')

  // Resolve the stored session once. A session idle past the timeout (e.g.
  // the tab was closed) is ended before any protected content renders.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const current = await client.currentUser()
      if (cancelled) return
      if (!current) {
        setStatus('signedOut')
        return
      }
      const last = readLastActivity()
      if (last !== null && idlePhase(now(), last) === 'expired') {
        rememberReturnTo(`${window.location.pathname}${window.location.search}${window.location.hash}`)
        await client.signOut()
        clearLastActivity()
        writePasskeyPending(null)
        if (cancelled) return
        setSignOutReason('expired')
        setStatus('signedOut')
        return
      }
      if (last === null) writeLastActivity(now())
      setUser(current)
      setStatus(readPasskeyPending() === current.userId ? 'needsPasskey' : 'signedIn')
    })()
    return () => {
      cancelled = true
    }
  }, [client, now])

  const signInWithPasskey = useCallback(
    async (email: string) => {
      const signedIn = await client.signInWithPasskey(email)
      writeLastActivity(now())
      writePasskeyPending(null)
      setUser(signedIn)
      setSignOutReason(null)
      setStatus('signedIn')
    },
    [client, now],
  )

  const confirmEmailCode = useCallback(
    async (code: string) => {
      const signedIn = await client.confirmEmailCode(code)
      writeLastActivity(now())
      // The code only unlocks passkey registration on this device.
      writePasskeyPending(signedIn.userId)
      setUser(signedIn)
      setSignOutReason(null)
      setStatus('needsPasskey')
    },
    [client, now],
  )

  const registerPasskey = useCallback(async () => {
    await client.registerPasskey()
    writePasskeyPending(null)
    setStatus('signedIn')
  }, [client])

  const signOut = useCallback(
    async (reason: SignOutReason = 'signedOut') => {
      await client.signOut()
      clearLastActivity()
      writePasskeyPending(null)
      setUser(null)
      setSignOutReason(reason)
      setStatus('signedOut')
    },
    [client],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      client,
      signOutReason,
      pendingEmail,
      setPendingEmail,
      signInWithPasskey,
      startEmailCode: (email) => client.startEmailCode(email),
      resendEmailCode: () => client.resendEmailCode(),
      confirmEmailCode,
      registerPasskey,
      signOut,
    }),
    [status, user, client, signOutReason, pendingEmail, signInWithPasskey, confirmEmailCode, registerPasskey, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
