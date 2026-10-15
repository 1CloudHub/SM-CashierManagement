/**
 * Sign-in against the LaneWise user pool with Amplify Auth (v6): the
 * choice-based USER_AUTH flow with an email one-time code or a passkey, the
 * same flows LaneWise offers (frontend/src/features/auth/amplify-auth-client.ts).
 * Passwords are never used.
 */
import { Amplify } from 'aws-amplify'
import {
  autoSignIn,
  confirmSignIn,
  confirmSignUp,
  fetchAuthSession,
  fetchUserAttributes,
  getCurrentUser,
  signIn,
  signOut,
  signUp,
} from 'aws-amplify/auth'
import type { AtriumConfig } from './config'

export const ALLOWED_DOMAINS = ['smretail.com', '1cloudhub.com'] as const

export function isAllowedEmail(email: string): boolean {
  const at = email.trim().toLowerCase().split('@')
  return at.length === 2 && at[0] !== '' && (ALLOWED_DOMAINS as readonly string[]).includes(at[1] as string)
}

export type AuthErrorCode =
  | 'domainNotAllowed'
  | 'codeMismatch'
  | 'codeExpired'
  | 'noPasskey'
  | 'passkeyCancelled'
  | 'tooManyAttempts'
  | 'unavailable'
  | 'unknown'

export class AuthError extends Error {
  readonly code: AuthErrorCode
  constructor(code: AuthErrorCode, options?: { cause?: unknown }) {
    super(code, options)
    this.code = code
  }
}

export function toAuthError(err: unknown): AuthError {
  if (err instanceof AuthError) return err
  const name = (err as { name?: unknown } | null)?.name
  const message = String((err as { message?: unknown } | null)?.message ?? '')
  // The pool's pre-sign-up trigger refuses other domains with this message (packages/shared/src/auth.ts).
  if (message.includes("domain isn't allowed")) return new AuthError('domainNotAllowed', { cause: err })
  switch (name) {
    case 'CodeMismatchException':
      return new AuthError('codeMismatch', { cause: err })
    case 'ExpiredCodeException':
      return new AuthError('codeExpired', { cause: err })
    case 'NotAuthorizedException':
      return new AuthError(/session/i.test(message) ? 'codeExpired' : 'unknown', { cause: err })
    case 'PasskeyAuthenticationCanceled':
    case 'PasskeyOperationAborted':
    case 'NotAllowedError':
    case 'AbortError':
      return new AuthError('passkeyCancelled', { cause: err })
    case 'LimitExceededException':
    case 'TooManyRequestsException':
    case 'TooManyFailedAttemptsException':
      return new AuthError('tooManyAttempts', { cause: err })
    case 'NetworkError':
    case 'InternalErrorException':
    case 'ServiceUnavailableException':
      return new AuthError('unavailable', { cause: err })
    default:
      return new AuthError('unknown', { cause: err })
  }
}

export interface SignedInUser {
  readonly email: string
  readonly name: string | null
}

type Pending = { kind: 'signUp' | 'signIn'; email: string }

export interface AtriumAuth {
  currentUser(): Promise<SignedInUser | null>
  signInWithPasskey(email: string): Promise<SignedInUser>
  startEmailCode(email: string): Promise<{ destination: string | null }>
  confirmEmailCode(code: string): Promise<SignedInUser>
  accessToken(): Promise<string | null>
  signOut(): Promise<void>
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw toAuthError(err)
  }
}

export function createAuth(config: AtriumConfig): AtriumAuth {
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

  async function currentUser(): Promise<SignedInUser | null> {
    try {
      const user = await getCurrentUser()
      const attrs = await fetchUserAttributes()
      return { email: attrs.email ?? user.signInDetails?.loginId ?? '', name: attrs.name ?? null }
    } catch {
      return null
    }
  }

  async function requireUser(): Promise<SignedInUser> {
    const user = await currentUser()
    if (!user) throw new AuthError('unknown')
    return user
  }

  async function sendSignInCode(email: string) {
    const out = await signIn({ username: email, options: { authFlowType: 'USER_AUTH', preferredChallenge: 'EMAIL_OTP' } })
    if (out.nextStep.signInStep !== 'CONFIRM_SIGN_IN_WITH_EMAIL_CODE') throw new AuthError('unavailable')
    pending = { kind: 'signIn', email }
    return { destination: out.nextStep.codeDeliveryDetails?.destination ?? null }
  }

  return {
    currentUser,

    signInWithPasskey: (email) =>
      guard(async () => {
        if (!isAllowedEmail(email)) throw new AuthError('domainNotAllowed')
        const out = await signIn({ username: email, options: { authFlowType: 'USER_AUTH', preferredChallenge: 'WEB_AUTHN' } })
        if (out.nextStep.signInStep !== 'DONE') throw new AuthError('noPasskey')
        return requireUser()
      }),

    startEmailCode: (email) =>
      guard(async () => {
        if (!isAllowedEmail(email)) throw new AuthError('domainNotAllowed')
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

    confirmEmailCode: (code) =>
      guard(async () => {
        if (!pending) throw new AuthError('codeExpired')
        if (pending.kind === 'signUp') {
          const out = await confirmSignUp({ username: pending.email, confirmationCode: code })
          if (out.nextStep.signUpStep !== 'COMPLETE_AUTO_SIGN_IN') throw new AuthError('unknown')
          const signedIn = await autoSignIn()
          if (signedIn.nextStep.signInStep !== 'DONE') throw new AuthError('unknown')
        } else {
          const out = await confirmSignIn({ challengeResponse: code })
          if (out.nextStep.signInStep !== 'DONE') throw new AuthError('unknown')
        }
        pending = null
        return requireUser()
      }),

    accessToken: async () => {
      try {
        const session = await fetchAuthSession()
        return session.tokens?.accessToken?.toString() ?? null
      } catch {
        return null
      }
    },

    signOut: async () => {
      pending = null
      try {
        await signOut()
      } catch {
        // tokens are cleared locally even if revocation fails
      }
    },
  }
}
