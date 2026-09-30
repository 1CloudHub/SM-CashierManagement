import { useEffect, useRef } from 'react'

/**
 * Route-change focus management (UX-004, design.md Accessibility: "visible
 * focus"; SPA navigation a11y).
 *
 * In a single-page app the browser does NOT move focus or announce a new page
 * on client-side navigation, so keyboard and screen-reader users are stranded
 * on the old, now-unmounted control. This hook restores the expected behaviour:
 * whenever the route key changes it moves focus to the main-content landmark
 * (`#main` by default), so the next Tab starts inside the new page and the
 * screen reader begins reading from the top of the content.
 *
 * The target must be focusable; the AppShell renders <main id="main"
 * tabIndex={-1}> for exactly this. Focus is applied after paint (rAF) so it
 * lands on the freshly-rendered content, and `preventScroll` keeps the browser
 * from double-scrolling on top of the SkipLink/anchor behaviour.
 *
 * Pass the current route key (pathname, or a router location key). The first
 * render is skipped so an initial full-page load — where the browser already
 * has focus handling — is left alone.
 *
 *   useRouteFocus(location.pathname)
 */
export function useRouteFocus(routeKey: string, targetId = 'main'): void {
  const isFirst = useRef(true)

  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false
      return
    }

    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(targetId)
      if (el) {
        el.focus({ preventScroll: true })
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [routeKey, targetId])
}

/**
 * Focus-restore for transient surfaces (menus, popovers, inline editors) that
 * are NOT Radix Dialog/Tabs (those already restore focus themselves). When the
 * surface opens, remember what was focused; when it closes, return focus there
 * so the user isn't dropped at the top of the document.
 *
 *   const restore = useRestoreFocus(open)
 *   // on close, call restore() (or let the effect run when `open` flips false)
 *
 * The hook auto-restores when `open` transitions from true to false. It also
 * returns a manual `restore()` for cases that need to control the timing (e.g.
 * restore before unmounting the surface).
 */
export function useRestoreFocus(open: boolean): () => void {
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const wasOpen = useRef(false)

  useEffect(() => {
    if (open && !wasOpen.current) {
      // Opening: capture the trigger so we can return to it.
      previouslyFocused.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
    }

    if (!open && wasOpen.current) {
      // Closing: return focus to the trigger if it is still in the document.
      const el = previouslyFocused.current
      if (el && document.contains(el)) {
        el.focus()
      }
      previouslyFocused.current = null
    }

    wasOpen.current = open
  }, [open])

  return () => {
    const el = previouslyFocused.current
    if (el && document.contains(el)) {
      el.focus()
    }
  }
}
