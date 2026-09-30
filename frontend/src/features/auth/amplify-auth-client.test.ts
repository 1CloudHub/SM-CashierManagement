import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  confirmSignIn: vi.fn(),
  confirmSignUp: vi.fn(),
  autoSignIn: vi.fn(),
  resendSignUpCode: vi.fn(),
  signOut: vi.fn(),
  getCurrentUser: vi.fn(),
  fetchUserAttributes: vi.fn(),
  fetchAuthSession: vi.fn(),
  associateWebAuthnCredential: vi.fn(),
  listWebAuthnCredentials: vi.fn(),
  deleteWebAuthnCredential: vi.fn(),
}))

vi.mock('aws-amplify/auth', () => auth)
vi.mock('aws-amplify', () => ({ Amplify: { configure: vi.fn() } }))

const { createAmplifyAuthClient } = await import('./amplify-auth-client')

const config = {
  userPoolId: 'ap-southeast-1_AbC123',
  userPoolClientId: 'abc123',
  selfSignUp: true,
  apiUrl: null,
}

function named(name: string, message = '') {
  return Object.assign(new Error(message), { name })
}

beforeEach(() => {
  for (const fn of Object.values(auth)) fn.mockReset()
  auth.getCurrentUser.mockResolvedValue({ userId: 'u-1', username: 'u-1' })
  auth.fetchUserAttributes.mockResolvedValue({ email: 'juan@smretail.com' })
})

describe('Amplify auth client — passkey sign-in (requirement 1.3)', () => {
  it('signs in with the WEB_AUTHN challenge via USER_AUTH', async () => {
    auth.signIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: 'DONE' } })
    const client = createAmplifyAuthClient(config)
    await expect(client.signInWithPasskey('juan@smretail.com')).resolves.toEqual({
      userId: 'u-1',
      email: 'juan@smretail.com',
    })
    expect(auth.signIn).toHaveBeenCalledWith({
      username: 'juan@smretail.com',
      options: { authFlowType: 'USER_AUTH', preferredChallenge: 'WEB_AUTHN' },
    })
  })

  it('never continues into other factors (no password path) when there is no passkey', async () => {
    auth.signIn.mockResolvedValue({
      isSignedIn: false,
      nextStep: { signInStep: 'CONTINUE_SIGN_IN_WITH_FIRST_FACTOR_SELECTION', availableChallenges: ['PASSWORD', 'EMAIL_OTP'] },
    })
    const client = createAmplifyAuthClient(config)
    await expect(client.signInWithPasskey('juan@smretail.com')).rejects.toMatchObject({ code: 'noPasskey' })
    expect(auth.confirmSignIn).not.toHaveBeenCalled()
  })

  it('refuses an outside domain before calling Cognito', async () => {
    const client = createAmplifyAuthClient(config)
    await expect(client.signInWithPasskey('juan@smretail.com.evil.io')).rejects.toMatchObject({ code: 'domainNotAllowed' })
    expect(auth.signIn).not.toHaveBeenCalled()
  })

  it('maps a cancelled passkey prompt', async () => {
    auth.signIn.mockRejectedValue(named('PasskeyAuthenticationCanceled'))
    const client = createAmplifyAuthClient(config)
    await expect(client.signInWithPasskey('juan@smretail.com')).rejects.toMatchObject({ code: 'passkeyCancelled' })
  })
})

describe('Amplify auth client — email code (requirement 1.4/1.5/1.7)', () => {
  it('self-signs-up a new user without a password, then confirms and auto-signs in', async () => {
    auth.signUp.mockResolvedValue({
      isSignUpComplete: false,
      nextStep: { signUpStep: 'CONFIRM_SIGN_UP', codeDeliveryDetails: { destination: 'j***@s***' } },
    })
    auth.confirmSignUp.mockResolvedValue({ nextStep: { signUpStep: 'COMPLETE_AUTO_SIGN_IN' } })
    auth.autoSignIn.mockResolvedValue({ nextStep: { signInStep: 'DONE' } })
    const client = createAmplifyAuthClient(config)

    await expect(client.startEmailCode('juan@smretail.com')).resolves.toEqual({ destination: 'j***@s***' })
    const input = auth.signUp.mock.calls[0]![0] as Record<string, unknown>
    expect(input).not.toHaveProperty('password')
    expect(input).toMatchObject({ username: 'juan@smretail.com', options: { userAttributes: { email: 'juan@smretail.com' } } })

    await expect(client.confirmEmailCode('123456')).resolves.toMatchObject({ userId: 'u-1' })
    expect(auth.confirmSignUp).toHaveBeenCalledWith({ username: 'juan@smretail.com', confirmationCode: '123456' })
  })

  it('sends a sign-in code (EMAIL_OTP) to an existing user', async () => {
    auth.signUp.mockRejectedValue(named('UsernameExistsException'))
    auth.signIn.mockResolvedValue({
      nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_EMAIL_CODE', codeDeliveryDetails: { destination: 'j***' } },
    })
    auth.confirmSignIn.mockResolvedValue({ nextStep: { signInStep: 'DONE' } })
    const client = createAmplifyAuthClient(config)

    await client.startEmailCode('juan@smretail.com')
    expect(auth.signIn).toHaveBeenCalledWith({
      username: 'juan@smretail.com',
      options: { authFlowType: 'USER_AUTH', preferredChallenge: 'EMAIL_OTP' },
    })
    await client.confirmEmailCode('654321')
    expect(auth.confirmSignIn).toHaveBeenCalledWith({ challengeResponse: '654321' })
  })

  it('does not sign up when self sign-up is off', async () => {
    auth.signIn.mockResolvedValue({ nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_EMAIL_CODE' } })
    const client = createAmplifyAuthClient({ ...config, selfSignUp: false })
    await client.startEmailCode('juan@smretail.com')
    expect(auth.signUp).not.toHaveBeenCalled()
  })

  it('surfaces the pre-sign-up rejection as domainNotAllowed', async () => {
    auth.signUp.mockRejectedValue(
      named('UserLambdaValidationException', "PreSignUp failed with error This work email domain isn't allowed.."),
    )
    const client = createAmplifyAuthClient(config)
    await expect(client.startEmailCode('juan@smretail.com')).rejects.toMatchObject({ code: 'domainNotAllowed' })
  })

  it('rejects a code step that would offer a password', async () => {
    auth.signUp.mockRejectedValue(named('UsernameExistsException'))
    auth.signIn.mockResolvedValue({ nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_PASSWORD' } })
    const client = createAmplifyAuthClient(config)
    await expect(client.startEmailCode('juan@smretail.com')).rejects.toMatchObject({ code: 'unavailable' })
  })
})

describe('Amplify auth client — passkey management (requirement 1.9)', () => {
  it('lists every page of passkeys', async () => {
    auth.listWebAuthnCredentials
      .mockResolvedValueOnce({ credentials: [{ credentialId: 'a', friendlyCredentialName: 'Mac' }], nextToken: 't' })
      .mockResolvedValueOnce({ credentials: [{ credentialId: 'b', createdAt: new Date(0) }] })
    const client = createAmplifyAuthClient(config)
    const list = await client.listPasskeys()
    expect(list.map((p) => p.id)).toEqual(['a', 'b'])
    expect(list[0]!.name).toBe('Mac')
    expect(list[1]!.name).toBeNull()
  })

  it('refuses to delete the last passkey (re-checked against the server)', async () => {
    auth.listWebAuthnCredentials.mockResolvedValue({ credentials: [{ credentialId: 'a' }] })
    const client = createAmplifyAuthClient(config)
    await expect(client.removePasskey('a')).rejects.toMatchObject({ code: 'lastPasskey' })
    expect(auth.deleteWebAuthnCredential).not.toHaveBeenCalled()
  })

  it('deletes a passkey when another remains', async () => {
    auth.listWebAuthnCredentials.mockResolvedValue({ credentials: [{ credentialId: 'a' }, { credentialId: 'b' }] })
    const client = createAmplifyAuthClient(config)
    await client.removePasskey('a')
    expect(auth.deleteWebAuthnCredential).toHaveBeenCalledWith({ credentialId: 'a' })
  })
})
