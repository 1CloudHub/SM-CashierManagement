import { useMemo } from 'react'
import { ApiProvider } from '@/api'
import { AnnouncerProvider } from '@/components/a11y'
import { ToastProvider } from '@/components/ui/toast'
import { I18nProvider } from '@/i18n'
import { ActiveRoleProvider } from './active-role'
import { defaultAdapter } from './api-adapter'
import { AppRoutes } from './app-routes'
import { RouterProvider } from './router'

/**
 * `npm run dev` without Cognito config (local UI work only — main.tsx never
 * mounts this in a production build, which fails closed instead): the app
 * shell and route table over the API adapter, with no sign-in. The component
 * gallery is at /gallery.
 */
export function DevApp() {
  const adapter = useMemo(() => defaultAdapter(import.meta.env.VITE_API_URL), [])
  return (
    <I18nProvider>
      <AnnouncerProvider>
        <ToastProvider>
          <RouterProvider>
            <ActiveRoleProvider>
              <ApiProvider adapter={adapter}>
                <AppRoutes />
              </ApiProvider>
            </ActiveRoleProvider>
          </RouterProvider>
        </ToastProvider>
      </AnnouncerProvider>
    </I18nProvider>
  )
}
