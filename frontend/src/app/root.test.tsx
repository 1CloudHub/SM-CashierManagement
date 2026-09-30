import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { LAST_ACTIVITY_STORAGE_KEY } from '@/features/auth/idle'
import { consumeReturnTo } from '@/features/auth/return-to'
import { JUAN, fakeClient, renderWithAuth, setPath } from '@/test/auth'
import { AuthRoutes } from './root'

const MIN = 60_000
const Home = () => (
  <main>
    <h1>Home</h1>
  </main>
)

beforeEach(() => {
  window.sessionStorage.clear()
  // jsdom has no WebAuthn: pretend this is a passkey-capable, secure context.
  vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {})
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
  Object.defineProperty(window.navigator, 'credentials', { value: {}, configurable: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('auth gate', () => {
  it('sends a signed-out visitor to sign-in and back to the requested URL afterwards', async () => {
    setPath('/profile?tab=passkeys')
    const user = userEvent.setup()
    const client = fakeClient()
    renderWithAuth(<AuthRoutes home={<Home />} />, client)

    await screen.findByRole('heading', { name: 'Sign in to LaneWise' })
    expect(window.location.pathname).toBe('/sign-in')

    vi.mocked(client.listPasskeys).mockResolvedValue([])
    await user.type(screen.getByLabelText(/work email/i), 'juan@smretail.com')
    await user.click(screen.getByRole('button', { name: 'Sign in with a passkey' }))
    await waitFor(() => expect(window.location.pathname).toBe('/profile'))
    expect(window.location.search).toBe('?tab=passkeys')
    expect(await screen.findByRole('heading', { level: 1, name: 'Profile and preferences' })).toBeInTheDocument()
  })

  it('keeps the app locked on passkey setup after an email-code sign-in (1.5)', async () => {
    setPath('/')
    window.localStorage.setItem('lw.auth.passkeyPending', JUAN.userId)
    renderWithAuth(<AuthRoutes home={<Home />} />, fakeClient({ currentUser: async () => JUAN }))
    expect(await screen.findByRole('heading', { name: 'Create a passkey' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/first-sign-in')
    expect(screen.queryByRole('heading', { name: 'Home' })).toBeNull()
  })

  it('shows the app to a signed-in user', async () => {
    setPath('/')
    const { container } = renderWithAuth(<AuthRoutes home={<Home />} />, fakeClient({ currentUser: async () => JUAN }))
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('ends a session that went idle past 60 minutes while the tab was closed', async () => {
    setPath('/roster')
    window.localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(Date.now() - 61 * MIN))
    const client = fakeClient({ currentUser: async () => JUAN })
    renderWithAuth(<AuthRoutes home={<Home />} />, client)
    expect(await screen.findByText('You were signed out after 60 minutes of inactivity.')).toBeInTheDocument()
    expect(client.signOut).toHaveBeenCalled()
    expect(consumeReturnTo()).toBe('/roster')
  })
})

describe('idle timeout (requirement 1.8)', () => {
  it('warns 2 minutes before, lets the user stay, and signs out at 60 idle minutes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setPath('/?view=network')
    const client = fakeClient({ currentUser: async () => JUAN })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithAuth(<AuthRoutes home={<Home />} />, client)
    await screen.findByRole('heading', { name: 'Home' })

    // 57 minutes: no warning yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(57 * MIN)
    })
    expect(screen.queryByRole('alertdialog')).toBeNull()

    // 58 minutes: the warning with "Stay signed in".
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1 * MIN + 1_000)
    })
    const dialog = await screen.findByRole('alertdialog', { name: 'You’ll be signed out soon' })
    expect(dialog).toHaveTextContent(/Time left: 1:5\d/)
    await user.click(screen.getByRole('button', { name: 'Stay signed in' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())

    // Another full hour without activity: signed out, URL remembered.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * MIN + 2_000)
    })
    await waitFor(() => expect(client.signOut).toHaveBeenCalled())
    expect(await screen.findByText('You were signed out after 60 minutes of inactivity.')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/sign-in')
    expect(consumeReturnTo()).toBe('/?view=network')
  })

  it('activity before the warning pushes the deadline back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setPath('/')
    const client = fakeClient({ currentUser: async () => JUAN })
    renderWithAuth(<AuthRoutes home={<Home />} />, client)
    await screen.findByRole('heading', { name: 'Home' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50 * MIN)
    })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20 * MIN)
    })
    expect(client.signOut).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})
