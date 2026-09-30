import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { vi } from 'vitest'
import { RouterProvider } from '@/app/router'
import { AnnouncerProvider } from '@/components/a11y'
import { I18nProvider } from '@/i18n'
import type { AuthClient, AuthUser, Passkey } from '@/features/auth/auth-client'
import { AuthProvider } from '@/features/auth/auth-context'

export const JUAN: AuthUser = { userId: 'u-juan', email: 'juan@smretail.com' }

export function passkey(id: string, name: string | null = `Device ${id}`): Passkey {
  return { id, name, createdAt: new Date('2026-09-20T08:00:00Z') }
}

/** A controllable fake of the auth port (no network, no WebAuthn). */
export function fakeClient(overrides: Partial<AuthClient> = {}) {
  const client = {
    selfSignUp: true,
    currentUser: vi.fn<AuthClient['currentUser']>().mockResolvedValue(null),
    signInWithPasskey: vi.fn<AuthClient['signInWithPasskey']>().mockResolvedValue(JUAN),
    startEmailCode: vi.fn<AuthClient['startEmailCode']>().mockResolvedValue({ destination: 'j***@smretail.com' }),
    resendEmailCode: vi.fn<AuthClient['resendEmailCode']>().mockResolvedValue({ destination: 'j***@smretail.com' }),
    confirmEmailCode: vi.fn<AuthClient['confirmEmailCode']>().mockResolvedValue(JUAN),
    registerPasskey: vi.fn<AuthClient['registerPasskey']>().mockResolvedValue(undefined),
    listPasskeys: vi.fn<AuthClient['listPasskeys']>().mockResolvedValue([passkey('a'), passkey('b')]),
    removePasskey: vi.fn<AuthClient['removePasskey']>().mockResolvedValue(undefined),
    signOut: vi.fn<AuthClient['signOut']>().mockResolvedValue(undefined),
    idToken: vi.fn<AuthClient['idToken']>().mockResolvedValue(null),
    ...overrides,
  } satisfies AuthClient
  return client
}

export function Providers({ client, children }: { client: AuthClient; children: ReactNode }) {
  return (
    <I18nProvider initialLocale="en">
      <AnnouncerProvider>
        <RouterProvider>
          <AuthProvider client={client}>{children}</AuthProvider>
        </RouterProvider>
      </AnnouncerProvider>
    </I18nProvider>
  )
}

export function renderWithAuth(ui: ReactNode, client: AuthClient = fakeClient()) {
  return { client, ...render(<Providers client={client}>{ui}</Providers>) }
}

export function setPath(path: string) {
  window.history.replaceState(null, '', path)
}
