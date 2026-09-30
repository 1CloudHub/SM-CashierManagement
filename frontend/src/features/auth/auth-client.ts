/**
 * The auth port the SPA talks to (task 7). Screens depend on this interface,
 * never on Amplify directly, so they can be tested with a fake and the
 * provider can be swapped without touching UI code.
 *
 * Every method either resolves or rejects with an `AuthFailure` whose `code`
 * maps 1:1 to a localised message — raw provider errors never reach the UI.
 */

/** The signed-in person, from verified Cognito tokens. */
export interface AuthUser {
  readonly userId: string
  readonly email: string
}

/** A registered passkey (WebAuthn credential). */
export interface Passkey {
  readonly id: string
  readonly name: string | null
  readonly createdAt: Date | null
}

/** Where the email one-time code was sent (masked by Cognito). */
export interface CodeDelivery {
  readonly destination: string | null
}

export type AuthFailureCode =
  /** Email outside smretail.com / 1cloudhub.com (requirement 1.1). */
  | 'domainNotAllowed'
  /** The browser's passkey prompt was cancelled / timed out. */
  | 'passkeyCancelled'
  /** The passkey ceremony failed for another reason. */
  | 'passkeyFailed'
  /** This device already holds a passkey for the account. */
  | 'passkeyExists'
  /** The account has no passkey to sign in with. */
  | 'noPasskey'
  /** The browser can't do WebAuthn (requirement 1.6). */
  | 'unsupported'
  | 'codeMismatch'
  | 'codeExpired'
  | 'tooManyAttempts'
  /** Refused: would remove the last passkey (requirement 1.9). */
  | 'lastPasskey'
  /** Network / Cognito unavailable. */
  | 'unavailable'
  | 'unknown'

export class AuthFailure extends Error {
  readonly code: AuthFailureCode
  constructor(code: AuthFailureCode, options?: { cause?: unknown }) {
    super(code, options)
    this.name = 'AuthFailure'
    this.code = code
  }
}

export function isAuthFailure(value: unknown): value is AuthFailure {
  return value instanceof AuthFailure
}

export interface AuthClient {
  /** Whether self sign-up (demo mode) is enabled for this pool. */
  readonly selfSignUp: boolean
  /** The current user from stored tokens, or `null` when signed out. */
  currentUser(): Promise<AuthUser | null>
  /** Passkey sign-in (requirement 1.3). Never falls back to a password. */
  signInWithPasskey(email: string): Promise<AuthUser>
  /**
   * Sends an email one-time code to register or recover a passkey
   * (requirement 1.4/1.5). Creates the account first when self sign-up is on
   * and the email is new (requirement 1.7).
   */
  startEmailCode(email: string): Promise<CodeDelivery>
  resendEmailCode(): Promise<CodeDelivery>
  /** Verifies the code; resolves with the (now signed-in) user. */
  confirmEmailCode(code: string): Promise<AuthUser>
  /** Registers a passkey for the signed-in user on this device. */
  registerPasskey(): Promise<void>
  listPasskeys(): Promise<Passkey[]>
  /** Removes a passkey; rejects with `lastPasskey` if it is the only one. */
  removePasskey(id: string): Promise<void>
  /** Signs out and revokes the refresh token. */
  signOut(): Promise<void>
  /** The ID token for API calls (Cognito authorizer), or `null`. */
  idToken(): Promise<string | null>
}

/** Whether this browser can create and use passkeys (requirement 1.6). */
export function isPasskeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext === true &&
    typeof navigator !== 'undefined' &&
    'credentials' in navigator &&
    typeof window.PublicKeyCredential === 'function'
  )
}
