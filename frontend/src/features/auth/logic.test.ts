import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { DOMAIN_NOT_ALLOWED_MESSAGE } from '@lanewise/shared'
import { BUNDLES } from '@/i18n'
import { toAuthFailure } from './amplify-auth-client'
import { AuthFailure } from './auth-client'
import {
  DEFAULT_IDLE_POLICY,
  formatCountdown,
  idlePhase,
  msUntilNextPhase,
  msUntilTimeout,
} from './idle'
import { consumeReturnTo, rememberReturnTo, sanitizeReturnTo } from './return-to'
import { parseRuntimeConfig } from './runtime-config'

const MIN = 60_000

describe('idle policy (requirement 1.8)', () => {
  it('is 60 minutes with a 2-minute warning', () => {
    expect(DEFAULT_IDLE_POLICY).toEqual({ timeoutMs: 60 * MIN, warningMs: 2 * MIN })
  })

  it('moves active → warning at 58 min → expired at 60 min', () => {
    expect(idlePhase(57 * MIN + 59_999, 0)).toBe('active')
    expect(idlePhase(58 * MIN, 0)).toBe('warning')
    expect(idlePhase(60 * MIN - 1, 0)).toBe('warning')
    expect(idlePhase(60 * MIN, 0)).toBe('expired')
  })

  it('property: the phase never goes backwards as idle time grows', () => {
    const rank = { active: 0, warning: 1, expired: 2 } as const
    fc.assert(
      fc.property(fc.nat(3 * 60 * MIN), fc.nat(3 * 60 * MIN), (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a]
        expect(rank[idlePhase(hi, 0)]).toBeGreaterThanOrEqual(rank[idlePhase(lo, 0)])
      }),
    )
  })

  it('property: sleeping until the next boundary lands exactly on a phase change', () => {
    fc.assert(
      fc.property(fc.nat(60 * MIN - 1), (now) => {
        const phase = idlePhase(now, 0)
        const next = now + msUntilNextPhase(now, 0)
        expect(idlePhase(next, 0)).not.toBe(phase)
        expect(msUntilTimeout(now, 0)).toBe(60 * MIN - now)
      }),
    )
  })

  it('formats the countdown as m:ss', () => {
    expect(formatCountdown(2 * MIN)).toBe('2:00')
    expect(formatCountdown(61_500)).toBe('1:02')
    expect(formatCountdown(0)).toBe('0:00')
    expect(formatCountdown(-5)).toBe('0:00')
  })
})

describe('return-to URL (requirement 1.8)', () => {
  it('keeps in-app paths with query and hash', () => {
    expect(sanitizeReturnTo('/roster?store=qc#dec-19')).toBe('/roster?store=qc#dec-19')
    expect(sanitizeReturnTo('/')).toBe('/')
  })

  it.each([
    'https://evil.io',
    '//evil.io/path',
    '/\\evil.io',
    '/.//evil.io',
    '/..//evil.io/x',
    '\\\\evil.io',
    'javascript:alert(1)',
    ' /roster',
    '/ro\nster',
    '/sign-in',
    '/first-sign-in?x=1',
    'roster',
    '',
  ])('rejects %j', (value) => {
    expect(sanitizeReturnTo(value)).toBeNull()
  })

  it('property: any accepted value stays same-origin and path-absolute', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.webUrl(),
          fc.webPath(),
          fc.string().map((s) => `/${s}`),
          // dot segments, slashes and backslashes: the classic normalisation tricks
          fc
            .array(fc.constantFrom('/', '.', '..', '\\', '%2f', 'evil.io', 'a', '?', '#'), { maxLength: 8 })
            .map((parts) => `/${parts.join('')}`),
        ),
        (value) => {
        const out = sanitizeReturnTo(value)
        if (out === null) return
        expect(out.startsWith('/')).toBe(true)
        expect(out.startsWith('//')).toBe(false)
        expect(new URL(out, 'https://app.example').origin).toBe('https://app.example')
        },
      ),
      { numRuns: 2000 },
    )
  })

  it('remembers once and falls back to Home', () => {
    rememberReturnTo('/profile?tab=passkeys')
    expect(consumeReturnTo()).toBe('/profile?tab=passkeys')
    expect(consumeReturnTo()).toBe('/')
    rememberReturnTo('//evil.io')
    expect(consumeReturnTo()).toBe('/')
  })
})

describe('runtime config', () => {
  const valid = {
    userPoolId: 'ap-southeast-1_AbC123xyz',
    userPoolClientId: '1a2b3c4d5e6f7g8h9i0j1k2l3m',
    selfSignUp: true,
    apiUrl: 'https://abc.execute-api.ap-southeast-1.amazonaws.com/prod/',
  }

  it('accepts the deploy-stage runtime-config.json shape', () => {
    expect(parseRuntimeConfig(valid)).toEqual(valid)
  })

  it('rejects missing or malformed ids (fail closed)', () => {
    expect(parseRuntimeConfig(null)).toBeNull()
    expect(parseRuntimeConfig('<!doctype html>')).toBeNull()
    expect(parseRuntimeConfig({ ...valid, userPoolId: 'nope' })).toBeNull()
    expect(parseRuntimeConfig({ ...valid, userPoolClientId: 'has spaces' })).toBeNull()
  })

  it('drops a non-https API URL', () => {
    expect(parseRuntimeConfig({ ...valid, apiUrl: 'http://x' })?.apiUrl).toBeNull()
  })
})

describe('provider error mapping', () => {
  const failure = (name: string, message = '') => toAuthFailure(Object.assign(new Error(message), { name })).code

  it('maps the pre-sign-up rejection to domainNotAllowed', () => {
    expect(failure('UserLambdaValidationException', `PreSignUp failed with error ${DOMAIN_NOT_ALLOWED_MESSAGE}.`)).toBe(
      'domainNotAllowed',
    )
  })

  it('maps WebAuthn cancellations and failures', () => {
    expect(failure('PasskeyAuthenticationCanceled')).toBe('passkeyCancelled')
    expect(failure('PasskeyRegistrationCanceled')).toBe('passkeyCancelled')
    expect(failure('PasskeyAlreadyExists')).toBe('passkeyExists')
    expect(failure('PasskeyNotSupported')).toBe('unsupported')
    expect(failure('RelyingPartyMismatch')).toBe('passkeyFailed')
  })

  it('maps one-time code errors', () => {
    expect(failure('CodeMismatchException')).toBe('codeMismatch')
    expect(failure('ExpiredCodeException')).toBe('codeExpired')
    expect(failure('NotAuthorizedException', 'Invalid session for the user.')).toBe('codeExpired')
    expect(failure('LimitExceededException')).toBe('tooManyAttempts')
  })

  it('passes AuthFailure through and defaults to unknown', () => {
    expect(toAuthFailure(new AuthFailure('lastPasskey')).code).toBe('lastPasskey')
    expect(failure('Whatever')).toBe('unknown')
  })

  it('shows the verbatim requirement 1.1 message in English', () => {
    expect(BUNDLES.en['auth.domainNotAllowed.title']).toBe(DOMAIN_NOT_ALLOWED_MESSAGE)
  })
})
