import { useEffect } from 'react'

/**
 * useUnsavedChanges (UX-010 "Unsaved changes" state).
 *
 * When `when` is true, warns before the browser unloads (reload / close /
 * external nav) so edits aren't lost. In-app navigation should additionally
 * show a "Discard changes?" confirmation dialog (compose the Dialog primitive)
 * — this hook covers the browser-level guard, which routers can't intercept.
 */
export function useUnsavedChanges(when: boolean) {
  useEffect(() => {
    if (!when) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // Modern browsers show their own generic prompt; a truthy return keeps
      // legacy behaviour working.
      e.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [when])
}
