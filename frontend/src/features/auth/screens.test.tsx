import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { axe } from 'vitest-axe'
import { AuthFailure } from './auth-client'
import { useAuth } from './auth-context'
import { FirstSignInScreen } from './first-sign-in-screen'
import { readOnboardingChoices } from './onboarding'
import { PasskeyManager } from './passkey-manager'
import { rememberReturnTo } from './return-to'
import { SignInScreen } from './sign-in-screen'
import { JUAN, fakeClient, passkey, renderWithAuth, setPath } from '@/test/auth'

beforeEach(() => {
  setPath('/sign-in')
  window.sessionStorage.clear()
})

/** The one non-empty role="alert" (the announcer's live region is empty). */
function findAlert(): Promise<HTMLElement> {
  return waitFor(() => {
    const alerts = screen.getAllByRole('alert').filter((el) => el.textContent?.trim())
    expect(alerts).toHaveLength(1)
    return alerts[0]!
  })
}

async function signedOut() {
  // The provider resolves the stored session asynchronously.
  await screen.findByRole('heading', { level: 1 })
}

describe('SCR-001 Sign in', () => {
  it('offers passkey sign-in only — no password field', async () => {
    const { container } = renderWithAuth(<SignInScreen passkeySupported />)
    await signedOut()
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in to LaneWise' })).toBeInTheDocument()
    expect(screen.getByLabelText(/work email/i)).toHaveAttribute('type', 'email')
    expect(screen.getByRole('button', { name: 'Sign in with a passkey' })).toBeInTheDocument()
    expect(container.querySelector('input[type="password"]')).toBeNull()
    expect(screen.queryByText(/password/i, { selector: 'label' })).toBeNull()
  })

  it('refuses an outside domain with the specified message, without calling Cognito', async () => {
    const user = userEvent.setup()
    const { client } = renderWithAuth(<SignInScreen passkeySupported />)
    await signedOut()
    await user.type(screen.getByLabelText(/work email/i), 'juan@smretail.com.evil.io')
    await user.click(screen.getByRole('button', { name: 'Sign in with a passkey' }))
    expect(await findAlert()).toHaveTextContent("This work email domain isn't allowed.")
    expect(screen.getByLabelText(/work email/i)).toHaveAttribute('aria-invalid', 'true')
    expect(client.signInWithPasskey).not.toHaveBeenCalled()
  })

  it('signs in with a normalised email', async () => {
    const user = userEvent.setup()
    const { client } = renderWithAuth(<SignInScreen passkeySupported />)
    await signedOut()
    await user.type(screen.getByLabelText(/work email/i), '  Juan@SMRetail.com ')
    await user.click(screen.getByRole('button', { name: 'Sign in with a passkey' }))
    await waitFor(() => expect(client.signInWithPasskey).toHaveBeenCalledWith('juan@smretail.com'))
  })

  it('shows the passkey-failed state with "Try again" and "Use an email code"', async () => {
    const user = userEvent.setup()
    const client = fakeClient({ signInWithPasskey: async () => Promise.reject(new AuthFailure('passkeyCancelled')) })
    renderWithAuth(<SignInScreen passkeySupported />, client)
    await signedOut()
    await user.type(screen.getByLabelText(/work email/i), 'juan@smretail.com')
    await user.click(screen.getByRole('button', { name: 'Sign in with a passkey' }))
    const alert = await findAlert()
    expect(alert).toHaveTextContent(/cancelled or didn’t work/)
    expect(within(alert).getByRole('button', { name: 'Use an email code' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('tells the user when the account has no passkey yet', async () => {
    const user = userEvent.setup()
    const client = fakeClient({ signInWithPasskey: async () => Promise.reject(new AuthFailure('noPasskey')) })
    renderWithAuth(<SignInScreen passkeySupported />, client)
    await signedOut()
    await user.type(screen.getByLabelText(/work email/i), 'juan@smretail.com')
    await user.click(screen.getByRole('button', { name: 'Sign in with a passkey' }))
    expect(await findAlert()).toHaveTextContent('There’s no passkey for this account yet.')
  })

  it('lists supported browsers and offers no fallback when passkeys are unsupported (1.6)', async () => {
    renderWithAuth(<SignInScreen passkeySupported={false} />)
    await signedOut()
    expect(screen.getByText('This browser doesn’t support passkeys.')).toBeInTheDocument()
    expect(screen.getByText(/Chrome, Edge, Safari or Firefox/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in with a passkey' })).toBeDisabled()
    expect(screen.queryByRole('link', { name: /set one up/i })).toBeNull()
  })

  it('has no axe violations (default and error states)', async () => {
    const user = userEvent.setup()
    const { container } = renderWithAuth(<SignInScreen passkeySupported />)
    await signedOut()
    expect(await axe(container)).toHaveNoViolations()
    await user.type(screen.getByLabelText(/work email/i), 'juan@gmail.com')
    await user.click(screen.getByRole('button', { name: 'Sign in with a passkey' }))
    await findAlert()
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('SCR-002 First sign-in / new device', () => {
  beforeEach(() => setPath('/first-sign-in'))

  it('walks verify email → create passkey → get started, then returns to the remembered URL', async () => {
    const user = userEvent.setup()
    rememberReturnTo('/profile')
    const { client } = renderWithAuth(<FirstSignInScreen passkeySupported />)

    await screen.findByRole('heading', { name: 'Verify your email' })
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Verify email')
    await user.type(screen.getByLabelText(/work email/i), 'juan@smretail.com')
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    expect(client.startEmailCode).toHaveBeenCalledWith('juan@smretail.com')

    expect(await screen.findByText('We sent a 6-digit code to juan@smretail.com.')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/^code/i), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify code' }))
    expect(client.confirmEmailCode).toHaveBeenCalledWith('123456')

    await screen.findByRole('heading', { name: 'Create a passkey' })
    expect(window.localStorage.getItem('lw.auth.passkeyPending')).toBe(JUAN.userId)
    await user.click(screen.getByRole('button', { name: 'Create passkey' }))
    expect(client.registerPasskey).toHaveBeenCalled()

    await screen.findByRole('heading', { name: 'Get started' })
    expect(window.localStorage.getItem('lw.auth.passkeyPending')).toBeNull()
    await user.selectOptions(screen.getByLabelText(/start as/i), 'STM')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(readOnboardingChoices()).toEqual({ startRole: 'STM', notifyInApp: true, notifyEmail: true })
    expect(window.location.pathname).toBe('/profile')
  })

  it('rejects an outside domain before sending a code', async () => {
    const user = userEvent.setup()
    const { client } = renderWithAuth(<FirstSignInScreen passkeySupported />)
    await screen.findByRole('heading', { name: 'Verify your email' })
    await user.type(screen.getByLabelText(/work email/i), 'juan@it.smretail.com')
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    expect(await screen.findByText("This work email domain isn't allowed.")).toBeInTheDocument()
    expect(client.startEmailCode).not.toHaveBeenCalled()
  })

  it('explains a wrong code and lets the user resend', async () => {
    const user = userEvent.setup()
    const client = fakeClient({ confirmEmailCode: async () => Promise.reject(new AuthFailure('codeMismatch')) })
    renderWithAuth(<FirstSignInScreen passkeySupported />, client)
    await screen.findByRole('heading', { name: 'Verify your email' })
    await user.type(screen.getByLabelText(/work email/i), 'juan@smretail.com')
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    await user.type(await screen.findByLabelText(/^code/i), '000000')
    await user.click(screen.getByRole('button', { name: 'Verify code' }))
    expect(await screen.findByText('That code isn’t right. Check the email and try again.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Resend code' }))
    expect(client.resendEmailCode).toHaveBeenCalled()
    expect(await screen.findByText('We sent a new code.')).toBeInTheDocument()
  })

  it('resumes at "Create a passkey" when signed in by code but without a passkey (the app stays locked)', async () => {
    window.localStorage.setItem('lw.auth.passkeyPending', JUAN.userId)
    const client = fakeClient({ currentUser: async () => JUAN })
    renderWithAuth(<FirstSignInGate />, client)
    expect(await screen.findByRole('heading', { name: 'Create a passkey' })).toBeInTheDocument()
  })

  it('has no axe violations', async () => {
    const { container } = renderWithAuth(<FirstSignInScreen passkeySupported />)
    await screen.findByRole('heading', { name: 'Verify your email' })
    expect(await axe(container)).toHaveNoViolations()
  })
})

/** Mounts SCR-002 only once the stored session has resolved. */
function FirstSignInGate() {
  const { status } = useAuth()
  return status === 'loading' ? null : <FirstSignInScreen passkeySupported />
}

describe('SCR-080 Passkeys (requirement 1.9)', () => {
  it('lists passkeys and removes one after confirmation', async () => {
    const user = userEvent.setup()
    const { client } = renderWithAuth(<PasskeyManager passkeySupported />)
    const table = await screen.findByRole('table', { name: 'Your passkeys' })
    expect(within(table).getByRole('rowheader', { name: 'Device a' })).toBeInTheDocument()
    expect(within(table).getByRole('rowheader', { name: 'Device b' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove passkey Device a' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove this passkey?' })
    await user.click(within(dialog).getByRole('button', { name: 'Remove passkey' }))
    await waitFor(() => expect(client.removePasskey).toHaveBeenCalledWith('a'))
  })

  it('blocks removing the last passkey', async () => {
    const client = fakeClient({ listPasskeys: async () => [passkey('only', 'iPhone')] })
    renderWithAuth(<PasskeyManager passkeySupported />, client)
    const remove = await screen.findByRole('button', { name: 'Remove passkey iPhone' })
    expect(remove).toBeDisabled()
    expect(remove).toHaveAccessibleDescription('You can’t remove your last passkey.')
  })

  it('shows the server refusal if the last passkey is removed elsewhere meanwhile', async () => {
    const user = userEvent.setup()
    const client = fakeClient({ removePasskey: async () => Promise.reject(new AuthFailure('lastPasskey')) })
    renderWithAuth(<PasskeyManager passkeySupported />, client)
    await user.click(await screen.findByRole('button', { name: 'Remove passkey Device a' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove passkey' }))
    expect(await findAlert()).toHaveTextContent('You can’t remove your last passkey.')
  })

  it('adds a passkey', async () => {
    const user = userEvent.setup()
    const { client } = renderWithAuth(<PasskeyManager passkeySupported />)
    await screen.findByRole('table')
    await user.click(screen.getByRole('button', { name: 'Add a passkey' }))
    await waitFor(() => expect(client.registerPasskey).toHaveBeenCalled())
    await waitFor(() => expect(client.listPasskeys).toHaveBeenCalledTimes(2))
  })

  it('has no axe violations', async () => {
    const { container } = renderWithAuth(<PasskeyManager passkeySupported />)
    await screen.findByRole('table')
    expect(await axe(container)).toHaveNoViolations()
  })
})
