import { useCallback, useMemo, type AnchorHTMLAttributes, type ReactNode } from 'react'
import { BrowserRouter, Navigate, useLocation, useNavigate } from 'react-router'
import { isPlainLeftClick } from './links'

/**
 * Routing (task 8.2): react-router (pinned) in declarative mode, behind the
 * small `useRouter` / `AppLink` / `Redirect` API the auth screens (task 7)
 * already use. The route table itself lives in ./app-routes; this module only
 * owns the history integration. CloudFront serves `index.html` for every path,
 * so deep links work.
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

export function RouterProvider({ children }: { children: ReactNode }) {
  return <BrowserRouter>{children}</BrowserRouter>
}

export function useRouter(): RouterValue {
  const { pathname, search, hash } = useLocation()
  const nav = useNavigate()
  const navigate = useCallback(
    (to: string, options?: { replace?: boolean }) => {
      void nav(to, { replace: options?.replace })
    },
    [nav],
  )
  return useMemo(
    () => ({ location: { pathname, search, hash }, href: `${pathname}${search}${hash}`, navigate }),
    [pathname, search, hash, navigate],
  )
}

/** Navigates once on mount (declarative redirect). */
export function Redirect({ to }: { to: string }) {
  return <Navigate to={to} replace />
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
        if (!isPlainLeftClick(e)) return
        e.preventDefault()
        navigate(href)
      }}
      {...props}
    />
  )
}
