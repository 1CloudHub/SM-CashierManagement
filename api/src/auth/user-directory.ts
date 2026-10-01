/**
 * The identity directory behind user administration (SCR-070/071): the
 * Cognito user pool (infra/lib/auth-stack.ts).
 *
 * Routes depend on the `UserDirectory` interface so tests inject a fake; the
 * production adapter is created only when `COGNITO_USER_POOL_ID` is set
 * (without it, invitations and deactivations change the app user only). The
 * API Lambda is granted exactly the `cognito-idp:Admin*` actions used here,
 * on this pool only (infra/lib/api-stack.ts).
 *
 * The pool signs users in by email (username = email) with passkeys; the
 * invitation email carries the link to the sign-in page, where the first
 * sign-in verifies the email with a one-time code and registers a passkey.
 */
import {
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';

export interface InviteOptions {
  readonly name: string;
  /** Re-send the invitation to a user who already exists in the pool. */
  readonly resend: boolean;
}

export interface UserDirectory {
  /** Creates the pool user and emails the invitation (or re-sends it). Enables a disabled user. */
  invite(email: string, options: InviteOptions): Promise<void>;
  /** Disables the pool user and signs them out everywhere. A user missing from the pool is ignored. */
  disable(email: string): Promise<void>;
}

/** The invitation could not be (re)sent because the user already completed sign-up. */
export class DirectoryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DirectoryConflictError';
  }
}

/** The subset of the SDK client this adapter calls (a fake in tests). */
export interface CognitoSender {
  send(command: object): Promise<unknown>;
}

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : '';
}

export function createCognitoDirectory(
  userPoolId: string,
  client: CognitoSender = new CognitoIdentityProviderClient({}),
): UserDirectory {
  const enable = (email: string) => client.send(new AdminEnableUserCommand({ UserPoolId: userPoolId, Username: email }));
  const create = (email: string, name: string, resend: boolean) =>
    client.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'name', Value: name },
        ],
        DesiredDeliveryMediums: ['EMAIL'],
        ...(resend ? { MessageAction: 'RESEND' as const } : {}),
      }),
    );

  async function invite(email: string, { name, resend }: InviteOptions): Promise<void> {
    try {
      await create(email, name, resend);
    } catch (error) {
      const code = errorName(error);
      // Already in the pool (e.g. self sign-up before the invitation): it can sign in; make sure it is enabled.
      if (!resend && code === 'UsernameExistsException') {
        await enable(email);
        return;
      }
      // RESEND for a user who is not in the pool yet (e.g. seeded): send a first invitation instead.
      if (resend && code === 'UserNotFoundException') {
        await create(email, name, false);
        return;
      }
      if (resend && code === 'UnsupportedUserStateException') {
        throw new DirectoryConflictError('This user has already signed in, so there is no invitation to resend.');
      }
      throw error;
    }
    if (resend) await enable(email);
  }

  async function disable(email: string): Promise<void> {
    try {
      await client.send(new AdminDisableUserCommand({ UserPoolId: userPoolId, Username: email }));
      await client.send(new AdminUserGlobalSignOutCommand({ UserPoolId: userPoolId, Username: email }));
    } catch (error) {
      if (errorName(error) === 'UserNotFoundException') return;
      throw error;
    }
  }

  return { invite, disable };
}

/** The directory from the environment, or `null` when no user pool is configured. */
export function userDirectoryFromEnv(env: NodeJS.ProcessEnv = process.env): UserDirectory | null {
  const poolId = env.COGNITO_USER_POOL_ID;
  return poolId ? createCognitoDirectory(poolId) : null;
}
