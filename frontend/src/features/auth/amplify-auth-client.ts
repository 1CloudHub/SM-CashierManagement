/**
 * `AuthClient` backed by AWS Amplify Auth (v6) against the Cognito user pool
 * (task 7.1).
 *
 * Why Amplify rather than raw Cognito API calls: Amplify ships the WebAuthn
 * ceremony plumbing (base64url (de)serialisation of the Cognito
 * `CREDENTIAL_REQUEST_OPTIONS` / `CredentialCreationOptions`, the
 * `navigator.credentials` calls and their error taxonomy), token storage and
 * automatic refresh, and the choice-based `USER_AUTH` flow — all security-
 * sensitive code we would otherwise hand-roll. It is imported modularly
 * (`aws-amplify/auth`) so only the auth category is bundled.
 *
 * Password flows are never used: every sign-in names its preferred challenge
 * (`WEB_AUTHN` or `EMAIL_OTP`), and a response offering anything else is
 * treated as a failure rather than continued.
 */
import { Amplify } from 'aws-amplify'
import {
  associateWebAuthnCredential,
  autoSignIn,
  confirmSignIn,
  confirmSignUp,
  deleteWebAuthnCredential,
  fetchAuthSession,
  fetchUserAttributes,
  getCurrentUser,
  listWebAuthnCredentials,
  resendSignUpCode,
  signIn,
  signOut,
  signUp,
  type SignInOutput,
} from 'aws-amplify/auth'
import { DOMAIN_NOT_ALLOWED_MESSAGE, isAllowedEmail } from '@lanewise/shared'
import {
  AuthFailure,
  type AuthClient,
  type AuthFailureCode,
  type AuthUser,
  type CodeDelivery,
  type Passkey,
} from './auth-client'
import type { RuntimeAuthConfig } from './runtime-config'

/** Provider error name/message → our failure code. Exported for tests. */
export function toAuthFailure(err: unknown): AuthFailure {
  if (err instanceof AuthFailure) return err
  const name = (err as { name?: unknown } | null)?.name
  const message = String((err as { message?: unknown } | null)?.message ?? '')
  const code = ((): AuthFailureCode => {
    if (message.includes(DOMAIN_NOT_ALLOWED_MESSAGE)) return 'domainNotAllowed'
    switch (name) {
      case 'PasskeyAuthenticationCanceled':
      case 'PasskeyRegistrationCanceled':
      case 'PasskeyOperationAborted':
      case 'NotAllowedError':
      case 'AbortError':
        return 'passkeyCancelled'
      case 'PasskeyAlreadyExists':
      case 'InvalidStateError':
        return 'passkeyExists'
      case 'PasskeyNotSupported':
        return 'unsupported'
      case 'PasskeyRetrievalFailed':
      case 'PasskeyRegistrationFailed':
      case 'RelyingPartyMismatch':
      case 'InvalidPasskeyAuthenticationOptions':
      case 'InvalidPasskeyRegistrationOptions':
      case 'WebAuthnNotEnabledException':
      case 'WebAuthnRelyingPartyMismatchException':
      case 'WebAuthnOriginNotAllowedException':
      case 'WebAuthnChallengeNotFoundException':
        return 'passkeyFailed'
      case 'CodeMismatchException':
        return 'codeMismatch'
      case 'ExpiredCodeException':
        return 'codeExpired'
      case 'LimitExceededException':
      case 'TooManyRequestsException':
      case 'TooManyFailedAttemptsException':
        return 'tooManyAttempts'
      case 'NetworkError':
      case 'InternalErrorException':
      case 'ServiceUnavailableException':
        return 'unavailable'
      case 'NotAuthorizedException':
        // An expired/used OTP session surfaces as NotAuthorized ("Invalid session").
        return /session/i.test(message) ? 'codeExpired' : 'unknown'
      default:
        return 'unknown'
    }
  })()
  return new AuthFailure(code, { cause: err })
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw toAuthFailure(err)
  }
}

function assertAllowed(email: string): void {
  // Early, friendly refusal; the pre-sign-up trigger is the real enforcement.
  if (!isAllowedEmail(email)) throw new AuthFailure('domainNotAllowed')
}

type Pending = { readonly kind: 'signUp' | 'signIn'; readonly email: string }

export function createAmplifyAuthClient(config: RuntimeAuthConfig): AuthClient {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: config.userPoolId,
        userPoolClientId: config.userPoolClientId,
        loginWith: { email: true },
        signUpVerificationMethod: 'code',
      },
    },
  })

  let pending: Pending | null = null

  async function currentUser(): Promise<AuthUser | null> {
    try {
      const user = await getCurrentUser()
      const attrs = await fetchUserAttributes()
      const email = attrs.email ?? user.signInDetails?.loginId ?? ''
      return attrs.name ? { userId: user.userId, email, name: attrs.name } : { userId: user.userId, email }
    } catch {
      return null
    }
  }

  async function requireUser(): Promise<AuthUser> {
    const user = await currentUser()
    if (!user) throw new AuthFailure('unknown')
    return user
  }

  async function sendSignInCode(email: string): Promise<CodeDelivery> {
    const out: SignInOutput = await signIn({
      username: email,
      options: { authFlowType: 'USER_AUTH', preferredChallenge: 'EMAIL_OTP' },
    })
    if (out.nextStep.signInStep !== 'CONFIRM_SIGN_IN_WITH_EMAIL_CODE') {
      // Anything else (e.g. a password prompt) is not a path we offer.
      throw new AuthFailure('unavailable')
    }
    pending = { kind: 'signIn', email }
    return { destination: out.nextStep.codeDeliveryDetails?.destination ?? null }
  }

  return {
    selfSignUp: config.selfSignUp,

    currentUser,

    signInWithPasskey: (email) =>
      guard(async () => {
        assertAllowed(email)
        const out = await signIn({
          username: email,
          options: { authFlowType: 'USER_AUTH', preferredChallenge: 'WEB_AUTHN' },
        })
        if (out.nextStep.signInStep !== 'DONE') {
          // Cognito offered other factors (no passkey registered). We never
          // continue into them — the email code is only for passkey setup.
          throw new AuthFailure('noPasskey')
        }
        return requireUser()
      }),

    startEmailCode: (email) =>
      guard(async () => {
        assertAllowed(email)
        pending = null
        if (config.selfSignUp) {
          try {
            const out = await signUp({
              username: email,
              options: { userAttributes: { email }, autoSignIn: { authFlowType: 'USER_AUTH' } },
            })
            if (out.nextStep.signUpStep === 'CONFIRM_SIGN_UP') {
              pending = { kind: 'signUp', email }
              return { destination: out.nextStep.codeDeliveryDetails.destination ?? null }
            }
          } catch (err) {
            if ((err as { name?: unknown }).name !== 'UsernameExistsException') throw err
          }
        }
        return sendSignInCode(email)
      }),

    resendEmailCode: () =>
      guard(async () => {
        if (!pending) throw new AuthFailure('codeExpired')
        if (pending.kind === 'signUp') {
          const out = await resendSignUpCode({ username: pending.email })
          return { destination: out.destination ?? null }
        }
        return sendSignInCode(pending.email)
      }),

    confirmEmailCode: (code) =>
      guard(async () => {
        if (!pending) throw new AuthFailure('codeExpired')
        if (pending.kind === 'signUp') {
          const out = await confirmSignUp({ username: pending.email, confirmationCode: code })
          if (out.nextStep.signUpStep !== 'COMPLETE_AUTO_SIGN_IN') throw new AuthFailure('unknown')
          const signedIn = await autoSignIn()
          if (signedIn.nextStep.signInStep !== 'DONE') throw new AuthFailure('unknown')
        } else {
          const out = await confirmSignIn({ challengeResponse: code })
          if (out.nextStep.signInStep !== 'DONE') throw new AuthFailure('unknown')
        }
        pending = null
        return requireUser()
      }),

    registerPasskey: () => guard(() => associateWebAuthnCredential()),

    listPasskeys: () =>
      guard(async () => {
        const all: Passkey[] = []
        let nextToken: string | undefined
        do {
          const page = await listWebAuthnCredentials(nextToken ? { nextToken } : {})
          for (const c of page.credentials) {
            if (!c.credentialId) continue
            all.push({
              id: c.credentialId,
              name: c.friendlyCredentialName ?? null,
              createdAt: c.createdAt ?? null,
            })
          }
          nextToken = page.nextToken
        } while (nextToken)
        return all
      }),

    removePasskey: (id) =>
      guard(async () => {
        // Re-check against the server list (another tab may have removed one).
        const page = await listWebAuthnCredentials({})
        const ids = page.credentials.map((c) => c.credentialId)
        if (ids.length <= 1 && !page.nextToken) throw new AuthFailure('lastPasskey')
        await deleteWebAuthnCredential({ credentialId: id })
      }),

    signOut: async () => {
      pending = null
      try {
        await signOut()
      } catch {
        // Tokens are cleared locally even if revocation fails (offline).
      }
    },

    idToken: async () => {
      try {
        const session = await fetchAuthSession()
        return session.tokens?.idToken?.toString() ?? null
      } catch {
        return null
      }
    },
  }
}
