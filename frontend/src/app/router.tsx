import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type ReactNode,
} from 'react'

/**
 * Minimal History-API router for the auth routes (task 7): the app has only a
 * handful of top-level paths today (`/sign-in`, `/first-sign-in`, `/profile`,
 * and the home screen). It is deliberately tiny and swappable for a full
 * router when the feature screens land. CloudFront serves `index.html` for
 * every path, so deep links work.
 */

export interface Location {
  readonly pathname: string
  readonly search: string
  readonly hash: string
}

export interface RouterValue {
  readonly location: Location
  /** `pathname + search + hash` — what return-to URLs store. */
  readonly href: string
  navigate: (to: string, options?: { replace?: boolean }) => void
}

const RouterContext = createContext<RouterValue | null>(null)

function readLocation(): Location {
  const { pathname, search, hash } = window.location
  return { pathname, search, hash }
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<Location>(readLocation)

  useEffect(() => {
    const onPop = () => setLocation(readLocation())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    if (options?.replace) window.history.replaceState(null, '', to)
    else window.history.pushState(null, '', to)
    setLocation(readLocation())
  }, [])

  const value = useMemo<RouterValue>(
    () => ({
      location,
      href: `${location.pathname}${location.search}${location.hash}`,
      navigate,
    }),
    [location, navigate],
  )
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export function useRouter(): RouterValue {
  const ctx = useContext(RouterContext)
  if (!ctx) throw new Error('useRouter must be used within a RouterProvider')
  return ctx
}

/** Navigates once on mount (declarative redirect). */
export function Redirect({ to }: { to: string }) {
  const { navigate } = useRouter()
  useEffect(() => {
    navigate(to, { replace: true })
  }, [navigate, to])
  return null
}

/** An in-app link: a real `<a href>` that navigates client-side on plain clicks. */
export function AppLink({
  href,
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const { navigate } = useRouter()
  return (
    <a
      href={href}
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        navigate(href)
      }}
      {...props}
    />
  )
}
