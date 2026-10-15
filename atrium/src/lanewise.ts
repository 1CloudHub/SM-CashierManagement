/**
 * One sign-in for Atrium and LaneWise.
 *
 * Both apps use the same Cognito user pool and app client, and Amplify keeps
 * the session in localStorage under `CognitoIdentityServiceProvider.<clientId>.*`.
 * Storage is per origin, so Atrium opens LaneWise at `/atrium-handoff`; that
 * page says it is ready, and Atrium posts the session entries to LaneWise's
 * exact origin. LaneWise accepts them only from Atrium's configured origins and
 * from its own opener (frontend/src/features/auth/atrium-handoff.ts). Nothing
 * travels in the URL.
 */
export const HANDOFF_PATH = '/atrium-handoff'
export const READY = 'lanewise:handoff-ready'
export const HANDOFF = 'atrium:handoff'

export function sessionEntries(clientId: string, storage: Storage = window.localStorage): Record<string, string> {
  const prefix = `CognitoIdentityServiceProvider.${clientId}.`
  const out: Record<string, string> = {}
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (!key || !key.startsWith(prefix)) continue
    const value = storage.getItem(key)
    if (value !== null) out[key] = value
  }
  return out
}

/** Opens LaneWise in a new tab and hands it this session. */
export function openLaneWise(laneWiseUrl: string, clientId: string, timeoutMs = 20000): void {
  const origin = new URL(laneWiseUrl).origin
  const win = window.open(`${origin}${HANDOFF_PATH}`, '_blank')
  if (!win) {
    window.location.assign(origin)
    return
  }
  const onMessage = (e: MessageEvent) => {
    if (e.origin !== origin || e.source !== win) return
    if ((e.data as { type?: unknown } | null)?.type !== READY) return
    win.postMessage({ type: HANDOFF, clientId, entries: sessionEntries(clientId) }, origin)
    cleanup()
  }
  const timer = window.setTimeout(() => cleanup(), timeoutMs)
  function cleanup() {
    window.removeEventListener('message', onMessage)
    window.clearTimeout(timer)
  }
  window.addEventListener('message', onMessage)
}
