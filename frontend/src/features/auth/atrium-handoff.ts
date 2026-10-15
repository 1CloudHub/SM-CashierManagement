/**
 * SM Atrium → LaneWise single sign-in.
 *
 * Atrium (atrium/) signs in against the same Cognito user pool and app client,
 * then opens LaneWise at `/atrium-handoff`. This page tells its opener it is
 * ready and waits for one message carrying the Amplify session entries
 * (`CognitoIdentityServiceProvider.<clientId>.*`), which it writes to
 * localStorage before Amplify starts. It accepts the message only:
 *  - from an origin listed in runtime-config `atriumOrigins`,
 *  - from the window that opened this one, and
 *  - for this app's own client id, with keys under that client's prefix.
 * Nothing travels in the URL. Without an opener (or on timeout) it simply
 * continues to normal sign-in.
 */
export const ATRIUM_HANDOFF_PATH = '/atrium-handoff'
const READY = 'lanewise:handoff-ready'
const HANDOFF = 'atrium:handoff'

export interface HandoffOptions {
  readonly origins: readonly string[]
  readonly clientId: string
  readonly timeoutMs?: number
  readonly win?: Window
}

/** Validates a handoff payload; returns the entries to store, or null. */
export function acceptHandoff(data: unknown, clientId: string): Record<string, string> | null {
  if (!data || typeof data !== 'object') return null
  const d = data as { type?: unknown; clientId?: unknown; entries?: unknown }
  if (d.type !== HANDOFF || d.clientId !== clientId) return null
  if (!d.entries || typeof d.entries !== 'object') return null
  const prefix = `CognitoIdentityServiceProvider.${clientId}.`
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(d.entries as Record<string, unknown>)) {
    if (!k.startsWith(prefix) || typeof v !== 'string' || v.length > 20000) return null
    out[k] = v
  }
  return Object.keys(out).length > 0 ? out : null
}

/** Receives the session from Atrium, then leaves the handoff URL. Resolves true when signed in. */
export function receiveAtriumHandoff({ origins, clientId, timeoutMs = 5000, win = window }: HandoffOptions): Promise<boolean> {
  const finish = (ok: boolean) => {
    win.history.replaceState(null, '', '/')
    return ok
  }
  const opener = win.opener as Window | null
  if (!opener || origins.length === 0) return Promise.resolve(finish(false))

  return new Promise((resolve) => {
    const onMessage = (e: MessageEvent) => {
      if (!origins.includes(e.origin) || e.source !== opener) return
      const entries = acceptHandoff(e.data, clientId)
      if (!entries) return
      for (const [k, v] of Object.entries(entries)) win.localStorage.setItem(k, v)
      done(true)
    }
    const timer = win.setTimeout(() => done(false), timeoutMs)
    function done(ok: boolean) {
      win.removeEventListener('message', onMessage)
      win.clearTimeout(timer)
      resolve(finish(ok))
    }
    win.addEventListener('message', onMessage)
    for (const origin of origins) opener.postMessage({ type: READY }, origin)
  })
}
