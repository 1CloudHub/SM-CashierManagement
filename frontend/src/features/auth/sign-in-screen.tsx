import { useState, type FormEvent } from 'react'
import { isAllowedEmail, normaliseEmailInput, parseEmail } from '@lanewise/shared'
import { AppLink, useRouter } from '@/app/router'
import { Stack } from '@/components/layout'
import { Alert, Button, Field, Input } from '@/components/ui'
import { useI18n } from '@/i18n'
import { isAuthFailure, isPasskeySupported, type AuthFailureCode } from './auth-client'
import { useAuth } from './auth-context'
import { AuthLayout } from './auth-layout'

type Problem = 'domainNotAllowed' | 'invalidEmail' | 'passkeyFailed' | 'noPasskey' | 'unavailable'

function problemFor(code: AuthFailureCode): Problem {
  switch (code) {
    case 'domainNotAllowed':
      return 'domainNotAllowed'
    case 'noPasskey':
      return 'noPasskey'
    case 'unavailable':
    case 'tooManyAttempts':
      return 'unavailable'
    default:
      return 'passkeyFailed'
  }
}

/**
 * SCR-001 Sign in (requirement 1.1, 1.3, 1.6, 1.8).
 *
 * Passkey sign-in only — there is no password field or password fallback.
 * States: default · domain not allowed · passkey cancelled/failed ("Try
 * again" / "Use an email code") · no passkey on the account · session expired
 * · browser without passkey support · Cognito unavailable.
 */
export function SignInScreen({ passkeySupported = isPasskeySupported() }: { passkeySupported?: boolean }) {
  const { t } = useI18n()
  const { navigate } = useRouter()
  const auth = useAuth()
  const [email, setEmail] = useState(auth.pendingEmail)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [busy, setBusy] = useState(false)

  const normalised = normaliseEmailInput(email)

  function validate(): boolean {
    if (!parseEmail(normalised)) {
      setProblem('invalidEmail')
      return false
    }
    if (!isAllowedEmail(normalised)) {
      setProblem('domainNotAllowed')
      return false
    }
    return true
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setProblem(null)
    if (!validate()) return
    setBusy(true)
    try {
      // On success the auth gate sends the user to the remembered URL.
      await auth.signInWithPasskey(normalised)
    } catch (err) {
      setProblem(isAuthFailure(err) ? problemFor(err.code) : 'passkeyFailed')
      setBusy(false)
    }
  }

  function goToEmailCode() {
    auth.setPendingEmail(isAllowedEmail(normalised) ? normalised : '')
    navigate('/first-sign-in')
  }

  const fieldError =
    problem === 'invalidEmail'
      ? t('auth.email.invalid')
      : problem === 'domainNotAllowed'
        ? t('auth.domainNotAllowed.title')
        : undefined

  return (
    <AuthLayout title={t('auth.signIn.pageTitle')}>
      <Stack gap={4}>
        <h1 className="text-h2 text-text">{t('auth.signIn.title')}</h1>

        {auth.signOutReason === 'expired' && (
          <Alert tone="info" title={t('auth.signIn.expired.title')}>
            {t('auth.signIn.expired.description')}
          </Alert>
        )}
        {!passkeySupported && (
          <Alert tone="warning" title={t('auth.unsupported.title')}>
            {t('auth.unsupported.description')}
          </Alert>
        )}
        {problem === 'domainNotAllowed' && (
          <Alert tone="danger" assertive title={t('auth.domainNotAllowed.title')}>
            {t('auth.domainNotAllowed.description')}
          </Alert>
        )}
        {problem === 'passkeyFailed' && (
          <Alert
            tone="danger"
            assertive
            title={t('auth.signIn.passkeyFailed.title')}
            action={
              <Button size="sm" onClick={goToEmailCode}>
                {t('auth.signIn.useEmailCode')}
              </Button>
            }
          >
            {t('auth.signIn.passkeyFailed.description')}
          </Alert>
        )}
        {problem === 'noPasskey' && (
          <Alert
            tone="warning"
            assertive
            title={t('auth.signIn.noPasskey.title')}
            action={
              <Button size="sm" onClick={goToEmailCode}>
                {t('auth.signIn.useEmailCode')}
              </Button>
            }
          >
            {t('auth.signIn.noPasskey.description')}
          </Alert>
        )}
        {problem === 'unavailable' && (
          <Alert tone="danger" assertive title={t('auth.unavailable.title')}>
            {t('auth.unavailable.description')}
          </Alert>
        )}

        <form onSubmit={onSubmit} noValidate>
          <Stack gap={4}>
            <Field label={t('auth.email.label')} error={fieldError} required>
              {(aria) => (
                <Input
                  {...aria}
                  type="email"
                  name="email"
                  inputMode="email"
                  autoComplete="username webauthn"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder={t('auth.email.placeholder')}
                  value={email}
                  invalid={Boolean(fieldError)}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              loadingLabel={t('auth.working')}
              disabled={!passkeySupported}
            >
              {problem === 'passkeyFailed' ? t('action.retry') : t('auth.signIn.submit')}
            </Button>
          </Stack>
        </form>

        {passkeySupported && (
          <p className="text-body">
            <AppLink
              href="/first-sign-in"
              className="text-text underline focus-visible:outline-focus-ring"
              onClick={() => auth.setPendingEmail(isAllowedEmail(normalised) ? normalised : '')}
            >
              {t('auth.signIn.setUp')} <span aria-hidden="true">→</span>
            </AppLink>
          </p>
        )}
        <p className="text-body-sm text-text-muted">{t('auth.signIn.footnote')}</p>
      </Stack>
    </AuthLayout>
  )
}
