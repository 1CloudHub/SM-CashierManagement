import type { RoleCode } from '@lanewise/shared'
import { render } from '@testing-library/react'
import { vi } from 'vitest'
import { createMockAdapter, ApiProvider, type ApiAdapter, type ApiRequest } from '@/api'
import { ActiveRoleProvider } from '@/app/active-role'
import { storeRole } from '@/app/active-role-storage'
import { AppRoutes } from '@/app/app-routes'
import { RouterProvider } from '@/app/router'
import { AnnouncerProvider } from '@/components/a11y'
import { I18nProvider } from '@/i18n'
import type { AuthClient } from '@/features/auth/auth-client'
import { AuthProvider } from '@/features/auth/auth-context'

/** Laptop-width matchMedia so the docked side nav renders (jsdom has no layout). */
export function useLaptopViewport() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('min-width'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
}

export interface RenderAppOptions {
  path?: string
  role?: RoleCode
  demo?: boolean
  assignedRoles?: RoleCode[]
  adapter?: ApiAdapter
  userId?: string
  /** Wraps the routes in an AuthProvider (needed by auth-only screens such as SCR-080 Profile). */
  auth?: AuthClient
}

/** Renders the signed-in route table with the mock API (no auth, no latency). */
export function renderApp({ path = '/', role, demo = true, assignedRoles, adapter, userId, auth }: RenderAppOptions = {}) {
  window.history.replaceState(null, '', path)
  if (role) storeRole(role, userId)
  const log: ApiRequest[] = []
  const api = adapter ?? createMockAdapter({ log })
  const routes = (
    <ActiveRoleProvider demo={demo} assignedRoles={assignedRoles} userId={userId}>
      <ApiProvider adapter={api}>
        <AppRoutes />
      </ApiProvider>
    </ActiveRoleProvider>
  )
  const result = render(
    <I18nProvider initialLocale="en">
      <AnnouncerProvider>
        <RouterProvider>{auth ? <AuthProvider client={auth}>{routes}</AuthProvider> : routes}</RouterProvider>
      </AnnouncerProvider>
    </I18nProvider>,
  )
  return { ...result, log }
}
