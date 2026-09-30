import type { PreSignUpTriggerEvent } from 'aws-lambda';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ALLOWED_EMAIL_DOMAINS, DOMAIN_NOT_ALLOWED_MESSAGE, isAllowedEmail } from '@lanewise/shared';
import { createLogger } from '../src/logger.js';
import {
  SELF_SIGN_UP_DISABLED_MESSAGE,
  createPreSignUpHandler,
  type PreSignUpHandler,
} from '../src/triggers/pre-sign-up.js';

type TriggerSource = PreSignUpTriggerEvent['triggerSource'];

function event(email: unknown, triggerSource: TriggerSource = 'PreSignUp_SignUp'): PreSignUpTriggerEvent {
  return {
    version: '1',
    region: 'ap-southeast-1',
    userPoolId: 'ap-southeast-1_test',
    userName: '5f6e0c1a-0000-4000-8000-000000000000',
    callerContext: { awsSdkVersion: 'test', clientId: 'client' },
    triggerSource,
    request: { userAttributes: typeof email === 'string' ? { email } : {} },
    response: { autoConfirmUser: false, autoVerifyEmail: false, autoVerifyPhone: false },
  } as PreSignUpTriggerEvent;
}

function handlerWith(selfSignUpEnabled = true): { handler: PreSignUpHandler; lines: string[] } {
  const lines: string[] = [];
  const logger = createLogger({ sink: (l) => lines.push(l) });
  return { handler: createPreSignUpHandler({ selfSignUpEnabled, logger }), lines };
}

describe('pre-sign-up trigger (task 7.2, requirement 1.1/1.2/1.7)', () => {
  it('allows self sign-up for an allowlisted email in demo mode without auto-confirming', async () => {
    const { handler } = handlerWith(true);
    const out = await handler(event('juan@smretail.com'));
    expect(out.response.autoConfirmUser).toBe(false);
    expect(out.response.autoVerifyEmail).toBe(false);
  });

  it('matches the domain case-insensitively', async () => {
    const { handler } = handlerWith(true);
    await expect(handler(event('Ana@1CloudHub.COM'))).resolves.toBeDefined();
  });

  it.each([
    'juan@gmail.com',
    'juan@smretail.com.evil.io',
    'juan@it.smretail.com',
    'juan@evilsmretail.com',
    'juan@smretail.com.',
    'juan@smretaıl.com',
    'not-an-email',
  ])('rejects %s with the requirement 1.1 message', async (email) => {
    const { handler } = handlerWith(true);
    await expect(handler(event(email))).rejects.toThrow(DOMAIN_NOT_ALLOWED_MESSAGE);
  });

  it('rejects an event with no email attribute', async () => {
    const { handler } = handlerWith(true);
    await expect(handler(event(undefined))).rejects.toThrow(DOMAIN_NOT_ALLOWED_MESSAGE);
  });

  it.each<TriggerSource>(['PreSignUp_AdminCreateUser', 'PreSignUp_ExternalProvider'])(
    'enforces the allowlist on %s too',
    async (source) => {
      const { handler } = handlerWith(false);
      await expect(handler(event('juan@gmail.com', source))).rejects.toThrow(DOMAIN_NOT_ALLOWED_MESSAGE);
      await expect(handler(event('juan@smretail.com', source))).resolves.toBeDefined();
    },
  );

  it('refuses self sign-up when demo mode is off, but still allows admin-created users', async () => {
    const { handler } = handlerWith(false);
    await expect(handler(event('juan@smretail.com'))).rejects.toThrow(SELF_SIGN_UP_DISABLED_MESSAGE);
    await expect(handler(event('juan@smretail.com', 'PreSignUp_AdminCreateUser'))).resolves.toBeDefined();
  });

  it('logs the rejected domain but never the full address', async () => {
    const { handler, lines } = handlerWith(true);
    await expect(handler(event('secret.person@evil.io'))).rejects.toThrow();
    const log = lines.join('\n');
    expect(log).toContain('evil.io');
    expect(log).not.toContain('secret.person');
  });
});

/**
 * P13 — Domain restriction: no account can exist with a domain outside the
 * allowlist.
 *
 * A model of the user pool: every creation path (self sign-up, admin create,
 * federated) runs the real trigger and only persists the user when it
 * resolves; `email` is immutable after creation (as configured in the
 * AuthStack), so the model exposes no update path. For any sequence of
 * creation attempts, every persisted account's email is on the allowlist.
 */
class UserPoolModel {
  readonly accounts = new Map<string, string>();
  constructor(private readonly trigger: PreSignUpHandler) {}

  async create(email: string, source: TriggerSource): Promise<boolean> {
    const key = email.toLowerCase();
    if (this.accounts.has(key)) return false;
    try {
      await this.trigger(event(email, source));
    } catch {
      return false;
    }
    this.accounts.set(key, email);
    return true;
  }
}

const localArb = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_+-'.split('')), { minLength: 1, maxLength: 12 })
  .map((c) => c.join(''));

const domainArb = fc.oneof(
  fc.constantFrom(...ALLOWED_EMAIL_DOMAINS),
  fc.constantFrom(...ALLOWED_EMAIL_DOMAINS).map((d) => d.toUpperCase()),
  fc.constantFrom(...ALLOWED_EMAIL_DOMAINS).map((d) => `${d}.evil.io`),
  fc.constantFrom(...ALLOWED_EMAIL_DOMAINS).map((d) => `mail.${d}`),
  fc.constantFrom(...ALLOWED_EMAIL_DOMAINS).map((d) => `x${d}`),
  fc.constantFrom('smretaıl.com', '1cloudhub.com.', 'smretail．com'),
  fc.domain(),
);

const emailArb = fc.oneof(
  fc.tuple(localArb, domainArb).map(([l, d]) => `${l}@${d}`),
  fc.emailAddress(),
  fc.string({ maxLength: 30 }),
);

const attemptArb = fc.record({
  email: emailArb,
  source: fc.constantFrom<TriggerSource>('PreSignUp_SignUp', 'PreSignUp_AdminCreateUser', 'PreSignUp_ExternalProvider'),
});

describe('P13 — no account exists with a domain outside the allowlist', () => {
  it('holds for any sequence of creation attempts through every sign-up path', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), fc.array(attemptArb, { maxLength: 25 }), async (demoMode, attempts) => {
        const pool = new UserPoolModel(createPreSignUpHandler({ selfSignUpEnabled: demoMode, logger: createLogger({ sink: () => undefined }) }));
        for (const { email, source } of attempts) await pool.create(email, source);
        for (const email of pool.accounts.values()) {
          expect(isAllowedEmail(email)).toBe(true);
          const domain = email.slice(email.indexOf('@') + 1).toLowerCase();
          expect(ALLOWED_EMAIL_DOMAINS).toContain(domain);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('every allowlisted email can self sign up in demo mode (requirement 1.7)', async () => {
    await fc.assert(
      fc.asyncProperty(localArb, fc.constantFrom(...ALLOWED_EMAIL_DOMAINS), async (local, domain) => {
        const pool = new UserPoolModel(createPreSignUpHandler({ selfSignUpEnabled: true, logger: createLogger({ sink: () => undefined }) }));
        expect(await pool.create(`${local}@${domain}`, 'PreSignUp_SignUp')).toBe(true);
      }),
    );
  });
});
