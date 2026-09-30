import { useEffect, type ReactNode } from 'react'
import { AnnouncerProvider } from '@/components/a11y'
import { Cluster, Page } from '@/components/layout'
import { ErrorPage } from '@/components/errors'
import { Spinner } from '@/components/ui'
import { ToastProvider } from '@/components/ui/toast'
import { AuthProvider, useAuth } from '@/features/auth/auth-context'
import type { AuthClient } from '@/features/auth/auth-client'
import { FirstSignInScreen } from '@/features/auth/first-sign-in-screen'
import { consumeReturnTo, rememberReturnTo } from '@/features/auth/return-to'
import { SessionGuard } from '@/features/auth/session-guard'
import { SignInScreen } from '@/features/auth/sign-in-screen'
import { I18nProvider, useI18n } from '@/i18n'
import { RouterProvider, useRouter } from './router'
import { SignedInApp } from './signed-in-app'

/**
 * Application root (task 7): providers + the auth gate.
 *
 *   signedOut    → /sign-in (SCR-001) or /first-sign-in (SCR-002); any other
 *                  URL is remembered and redirected to /sign-in
 *   needsPasskey → /first-sign-in, step 2 (the app stays locked)
 *   signedIn     → the app (route table in ./app-routes), inside the
 *                  idle-timeout guard
 */
export function Root({ client, apiBaseUrl }: { client: AuthClient; apiBaseUrl?: string | null }) {
  return (
    <I18nProvider>
      <AnnouncerProvider>
        <ToastProvider>
          <RouterProvider>
            <AuthProvider client={client}>
              <AuthRoutes apiBaseUrl={apiBaseUrl} />
            </AuthProvider>
          </RouterProvider>
        </ToastProvider>
      </AnnouncerProvider>
    </I18nProvider>
  )
}

function FullPageLoading() {
  const { t } = useI18n()
  return (
    <main id="main" className="min-h-screen bg-bg py-12" aria-busy="true">
      <Page>
        <Cluster justify="center" gap={2} role="status" className="text-body text-text-muted">
          <Spinner />
          {t('state.loading')}
        </Cluster>
      </Page>
    </main>
  )
}

/**
 * `home` replaces the whole signed-in app with a single `/` screen (auth-gate
 * tests); every other path is then a 404.
 */
export function AuthRoutes({ home, apiBaseUrl }: { home?: ReactNode; apiBaseUrl?: string | null }) {
  const { status } = useAuth()
  const { location, href } = useRouter()
  const path = location.pathname

  if (status === 'loading') return <FullPageLoading />

  if (status === 'needsPasskey') {
    if (path !== '/first-sign-in') return <RememberAndRedirect from={href} to="/first-sign-in" />
    return <FirstSignInScreen />
  }

  if (path === '/first-sign-in') return <FirstSignInScreen />

  if (status === 'signedOut') {
    if (path === '/sign-in') return <SignInScreen />
    return <RememberAndRedirect from={href} to="/sign-in" />
  }

  // signedIn
  if (path === '/sign-in') return <ReturnAfterSignIn />
  return (
    <SessionGuard>
      {home === undefined ? (
        <SignedInApp apiBaseUrl={apiBaseUrl} />
      ) : path === '/' || path === '/index.html' ? (
        home
      ) : (
        <ErrorPage kind="404" layout="bare" />
      )}
    </SessionGuard>
  )
}

/** Remembers the requested URL, then redirects (to sign-in / passkey setup). */
function RememberAndRedirect({ from, to }: { from: string; to: string }) {
  const { navigate } = useRouter()
  useEffect(() => {
    rememberReturnTo(from)
    navigate(to, { replace: true })
  }, [from, to, navigate])
  return null
}

/** Already signed in on /sign-in: go to the remembered URL (or Home). */
function ReturnAfterSignIn() {
  const { navigate } = useRouter()
  useEffect(() => {
    navigate(consumeReturnTo('/'), { replace: true })
  }, [navigate])
  return null
}

/**
 * Shown when the SPA has no Cognito configuration: fail closed (no app
 * content without sign-in), as a 503 with a retry.
 */
export function AuthNotConfigured() {
  return (
    <I18nProvider>
      <ErrorPage kind="503" layout="bare" onAction={() => window.location.reload()} />
    </I18nProvider>
  )
}
