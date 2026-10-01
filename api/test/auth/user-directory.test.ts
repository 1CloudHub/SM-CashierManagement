import { describe, expect, it } from 'vitest';
import { DirectoryConflictError, createCognitoDirectory, userDirectoryFromEnv } from '../../src/auth/user-directory.js';

interface Sent {
  readonly command: string;
  readonly input: Record<string, unknown>;
}

/** Records the commands sent; `fail` maps a command name to the error name it throws. */
function fakeClient(fail: Record<string, string> = {}) {
  const sent: Sent[] = [];
  return {
    sent,
    async send(command: object) {
      const name = command.constructor.name;
      sent.push({ command: name, input: (command as { input: Record<string, unknown> }).input });
      const error = fail[name];
      if (error) {
        delete fail[name];
        throw Object.assign(new Error(error), { name: error });
      }
      return {};
    },
  };
}

describe('Cognito user directory', () => {
  it('invites by email with a verified email attribute and the email delivery medium', async () => {
    const client = fakeClient();
    await createCognitoDirectory('pool-1', client).invite('ana@smretail.com', { name: 'Ana', resend: false });
    expect(client.sent).toEqual([
      {
        command: 'AdminCreateUserCommand',
        input: {
          UserPoolId: 'pool-1',
          Username: 'ana@smretail.com',
          UserAttributes: [
            { Name: 'email', Value: 'ana@smretail.com' },
            { Name: 'email_verified', Value: 'true' },
            { Name: 'name', Value: 'Ana' },
          ],
          DesiredDeliveryMediums: ['EMAIL'],
        },
      },
    ]);
  });

  it('enables an existing pool user instead of failing the invitation', async () => {
    const client = fakeClient({ AdminCreateUserCommand: 'UsernameExistsException' });
    await createCognitoDirectory('p', client).invite('a@smretail.com', { name: 'A', resend: false });
    expect(client.sent.map((s) => s.command)).toEqual(['AdminCreateUserCommand', 'AdminEnableUserCommand']);
  });

  it('resends with RESEND, falls back to a first invitation, and refuses a confirmed user', async () => {
    const resend = fakeClient();
    await createCognitoDirectory('p', resend).invite('a@smretail.com', { name: 'A', resend: true });
    expect(resend.sent[0]?.input.MessageAction).toBe('RESEND');

    const missing = fakeClient({ AdminCreateUserCommand: 'UserNotFoundException' });
    await createCognitoDirectory('p', missing).invite('a@smretail.com', { name: 'A', resend: true });
    expect(missing.sent.map((s) => s.input.MessageAction)).toEqual(['RESEND', undefined]);

    const confirmed = fakeClient({ AdminCreateUserCommand: 'UnsupportedUserStateException' });
    await expect(createCognitoDirectory('p', confirmed).invite('a@smretail.com', { name: 'A', resend: true })).rejects.toBeInstanceOf(
      DirectoryConflictError,
    );
  });

  it('disables and signs out; a user missing from the pool is ignored; other errors surface', async () => {
    const client = fakeClient();
    await createCognitoDirectory('p', client).disable('a@smretail.com');
    expect(client.sent.map((s) => s.command)).toEqual(['AdminDisableUserCommand', 'AdminUserGlobalSignOutCommand']);
    await expect(createCognitoDirectory('p', fakeClient({ AdminDisableUserCommand: 'UserNotFoundException' })).disable('a@smretail.com')).resolves.toBeUndefined();
    await expect(createCognitoDirectory('p', fakeClient({ AdminDisableUserCommand: 'TooManyRequestsException' })).disable('a@smretail.com')).rejects.toThrow();
  });

  it('is configured only when COGNITO_USER_POOL_ID is set', () => {
    expect(userDirectoryFromEnv({})).toBeNull();
    expect(userDirectoryFromEnv({ COGNITO_USER_POOL_ID: 'ap-southeast-1_x' })).not.toBeNull();
  });
});
