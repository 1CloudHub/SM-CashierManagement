import { useEffect, useState } from 'react'

/**
 * useMediaQuery — subscribe to a CSS media query from React.
 *
 * Used by the shell to pick the nav presentation at the design breakpoints
 * (rail vs expanded) with a single rendered nav, rather than mounting one
 * <nav> per breakpoint (which would create duplicate navigation landmarks).
 * SSR / jsdom without matchMedia falls back to `false`.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
