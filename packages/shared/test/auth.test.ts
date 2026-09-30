import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_EMAIL_DOMAINS,
  DOMAIN_NOT_ALLOWED_MESSAGE,
  SESSION_POLICY,
  emailDomain,
  isAllowedDomain,
  isAllowedEmail,
  normaliseEmailInput,
  parseEmail,
} from '../src/index.js';

const LOCAL_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._+-';

/** A valid dot-atom local part. */
const localArb = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_+-'.split('')), { minLength: 1, maxLength: 20 })
  .map((cs) => cs.join(''));

/** Random casing of a string (ASCII only). */
function randomCase(s: string): fc.Arbitrary<string> {
  return fc
    .array(fc.boolean(), { minLength: s.length, maxLength: s.length })
    .map((flags) => s.split('').map((c, i) => (flags[i] ? c.toUpperCase() : c)).join(''));
}

const allowedDomainArb = fc.constantFrom(...ALLOWED_EMAIL_DOMAINS).chain(randomCase);

/** Domains engineered to look like the allowlist but not be on it. */
const trickDomainArb = fc.oneof(
  // suffix/prefix tricks
  fc.constantFrom(...ALLOWED_EMAIL_DOMAINS).map((d) => `${d}.evil.io`),
  fc.constantFrom(...ALLOWED_EMAIL_DOMAINS).map((d) => `evil${d}`),
  fc.constantFrom(...ALLOWED_EMAIL_DOMAINS).map((d) => `${d}.`),
  fc.constantFrom(...ALLOWED_EMAIL_DOMAINS).map((d) => `${d}-evil.com`),
  fc.constantFrom(...ALLOWED_EMAIL_DOMAINS).map((d) => d.replace('.com', '.co')),
  // subdomains are not on the allowlist
  fc.tuple(localArb, fc.constantFrom(...ALLOWED_EMAIL_DOMAINS)).map(([sub, d]) => `${sub}.${d}`),
  // look-alike unicode
  fc.constantFrom('smretaıl.com', 'ѕmretail.com', 'smretail.cοm', '1cloudhub.ｃｏｍ', 'smretail．com'),
  // anything else
  fc.domain(),
);

describe('email allowlist (P13, requirement 1.1/1.2)', () => {
  it('uses the verbatim rejection message from requirement 1.1', () => {
    expect(DOMAIN_NOT_ALLOWED_MESSAGE).toBe("This work email domain isn't allowed.");
  });

  it('allows exactly smretail.com and 1cloudhub.com', () => {
    expect(ALLOWED_EMAIL_DOMAINS).toEqual(['smretail.com', '1cloudhub.com']);
    expect(isAllowedEmail('juan@smretail.com')).toBe(true);
    expect(isAllowedEmail('ana.reyes+test@1cloudhub.com')).toBe(true);
  });

  it('matches the domain case-insensitively', () => {
    expect(isAllowedEmail('Juan@SMRetail.COM')).toBe(true);
    expect(isAllowedDomain('1CloudHub.Com')).toBe(true);
  });

  it.each([
    ['juan@smretail.com.evil.io'],
    ['juan@evilsmretail.com'],
    ['juan@it.smretail.com'],
    ['juan@smretail.com.'],
    ['juan@smretail.co'],
    ['juan@gmail.com'],
    ['juan@smretail.com@evil.io'],
    ['juan@evil.io@smretail.com'],
    ['"juan@evil.io"@smretail.com'],
    [' juan@smretail.com'],
    ['juan@smretail.com '],
    ['juan @smretail.com'],
    ['juan@[127.0.0.1]'],
    ['@smretail.com'],
    ['juan@'],
    ['juan'],
    ['.juan@smretail.com'],
    ['ju..an@smretail.com'],
    ['juan@smretaıl.com'],
    ['juan@smretail．com'],
    [''],
  ])('rejects %j', (email) => {
    expect(isAllowedEmail(email)).toBe(false);
  });

  it('rejects non-strings', () => {
    for (const v of [undefined, null, 42, {}, ['juan@smretail.com']]) {
      expect(isAllowedEmail(v)).toBe(false);
    }
  });

  it('rejects over-long addresses', () => {
    expect(isAllowedEmail(`${'a'.repeat(65)}@smretail.com`)).toBe(false);
    expect(isAllowedEmail(`${'a'.repeat(64)}@smretail.com`)).toBe(true);
  });

  it('property: any valid local part on an allowed domain (any case) is accepted', () => {
    fc.assert(
      fc.property(localArb, allowedDomainArb, (local, domain) => {
        fc.pre(!local.startsWith('.') && !local.endsWith('.') && !local.includes('..'));
        expect(isAllowedEmail(`${local}@${domain}`)).toBe(true);
        expect(emailDomain(`${local}@${domain}`)).toBe(domain.toLowerCase());
      }),
    );
  });

  it('property: look-alike, suffix, subdomain and foreign domains are always rejected', () => {
    fc.assert(
      fc.property(localArb, trickDomainArb, (local, domain) => {
        fc.pre(!(ALLOWED_EMAIL_DOMAINS as readonly string[]).includes(domain.toLowerCase()));
        expect(isAllowedEmail(`${local}@${domain}`)).toBe(false);
      }),
    );
  });

  it('property: acceptance implies the domain after the only @ is exactly an allowed domain', () => {
    const anyEmail = fc.oneof(
      fc.emailAddress(),
      fc.string({ maxLength: 40 }),
      fc.tuple(fc.string({ unit: fc.constantFrom(...LOCAL_CHARS.split('')) }), trickDomainArb).map(([l, d]) => `${l}@${d}`),
      fc.tuple(localArb, allowedDomainArb).map(([l, d]) => `${l}@${d}`),
    );
    fc.assert(
      fc.property(anyEmail, (email) => {
        if (!isAllowedEmail(email)) return;
        const parts = email.split('@');
        expect(parts).toHaveLength(2);
        expect(ALLOWED_EMAIL_DOMAINS).toContain(parts[1]!.toLowerCase());
        expect(email).toBe(email.trim());
      }),
      { numRuns: 500 },
    );
  });

  it('parseEmail lower-cases only the domain', () => {
    expect(parseEmail('Juan.Dela@SMRetail.com')).toEqual({ local: 'Juan.Dela', domain: 'smretail.com' });
  });

  it('normaliseEmailInput trims and lower-cases typed input', () => {
    expect(normaliseEmailInput('  Juan@SMRetail.com\n')).toBe('juan@smretail.com');
    expect(isAllowedEmail(normaliseEmailInput('  Juan@SMRetail.com '))).toBe(true);
  });
});

describe('session policy (requirement 1.8)', () => {
  it('times out after 60 idle minutes with a 2-minute warning', () => {
    expect(SESSION_POLICY.idleTimeoutMinutes).toBe(60);
    expect(SESSION_POLICY.idleWarningMinutes).toBe(2);
  });

  it('keeps token lifetimes aligned with the idle timeout', () => {
    expect(SESSION_POLICY.accessTokenMinutes).toBe(SESSION_POLICY.idleTimeoutMinutes);
    expect(SESSION_POLICY.refreshTokenHours * 60).toBeGreaterThan(SESSION_POLICY.idleTimeoutMinutes);
  });
});
