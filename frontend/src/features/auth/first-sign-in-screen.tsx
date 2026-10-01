import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Check } from 'lucide-react'
import { ROLE_CODES, isAllowedEmail, isRoleCode, normaliseEmailInput, parseEmail, type RoleCode } from '@lanewise/shared'
import { Redirect, useRouter } from '@/app/router'
import { Cluster, Stack } from '@/components/layout'
import { Alert, Button, Checkbox, Field, Input, Select } from '@/components/ui'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { isAuthFailure, isPasskeySupported, type AuthFailureCode } from './auth-client'
import { useAuth } from './auth-context'
import { AuthLayout } from './auth-layout'
import { saveOnboardingChoices } from './onboarding'
import { consumeReturnTo } from './return-to'

type Step = 1 | 2 | 3
const TOTAL_STEPS = 3
const CODE_PATTERN = /^\d{6}$/

function codeMessageId(code: AuthFailureCode): string {
  switch (code) {
    case 'codeMismatch':
      return 'auth.first.codeMismatch'
    case 'codeExpired':
      return 'auth.first.codeExpired'
    case 'tooManyAttempts':
      return 'auth.first.tooManyAttempts'
    case 'domainNotAllowed':
      return 'auth.domainNotAllowed.title'
    default:
      return 'auth.unavailable.title'
  }
}

/**
 * SCR-002 First sign-in / new device (requirement 1.4, 1.5, 1.7).
 *
 *   1. Verify email — a 6-digit one-time code (creates the account first when
 *      self sign-up is on and the email is new; the pre-sign-up trigger
 *      refuses outside domains).
 *   2. Create a passkey — the code only ever unlocks this step; the app stays
 *      locked until a passkey is registered on this device.
 *   3. Get started — demo starting role and notification choices.
 */
export function FirstSignInScreen({ passkeySupported = isPasskeySupported() }: { passkeySupported?: boolean }) {
  const { t } = useI18n()
  const auth = useAuth()
  // The step this visit starts at, fixed on mount; later steps are local state.
  const [step, setStep] = useState<Step | 'done'>(() =>
    auth.status === 'needsPasskey' ? 2 : auth.status === 'signedIn' ? 'done' : 1,
  )
  const headingRef = useRef<HTMLHeadingElement>(null)

  // Move focus to the step heading as the flow advances (SPA focus management).
  useEffect(() => {
    headingRef.current?.focus()
  }, [step])

  if (step === 'done') return <Redirect to="/" />
  const stepTitles: Record<Step, string> = {
    1: t('auth.first.step1'),
    2: t('auth.first.step2'),
    3: t('auth.first.step3'),
  }

  return (
    <AuthLayout title={t('auth.first.pageTitle')}>
      <Stack gap={6}>
        <Stack gap={3}>
          <h1 className="text-h2 text-text">{t('auth.first.title')}</h1>
          <ol aria-label={t('auth.first.stepsLabel')} className="flex flex-wrap gap-3">
            {([1, 2, 3] as const).map((n) => {
              const completed = n < step
              return (
                <li
                  key={n}
                  aria-current={n === step ? 'step' : undefined}
                  className={cn(
                    'flex items-center gap-2 text-body-sm',
                    n === step ? 'font-weight-semibold text-text' : completed ? 'text-text' : 'text-text-muted',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'lw-numeric inline-flex size-6 items-center justify-center border',
                      n === step ? 'border-primary bg-primary text-on-primary' : 'border-outline',
                    )}
                  >
                    {completed ? <Check className="size-4" /> : n}
                  </span>
                  <span className="sr-only">{t('auth.first.stepOf', { step: n, total: TOTAL_STEPS })}: </span>
                  {stepTitles[n]}
                  {completed && <span className="sr-only"> ({t('auth.first.stepDone')})</span>}
                </li>
              )
            })}
          </ol>
        </Stack>

        {!passkeySupported && (
          <Alert tone="warning" title={t('auth.unsupported.title')}>
            {t('auth.unsupported.description')}
          </Alert>
        )}

        {step === 1 && (
          <VerifyEmailStep headingRef={headingRef} disabled={!passkeySupported} onVerified={() => setStep(2)} />
        )}
        {step === 2 && <CreatePasskeyStep headingRef={headingRef} disabled={!passkeySupported} onCreated={() => setStep(3)} />}
        {step === 3 && <GetStartedStep headingRef={headingRef} />}
      </Stack>
    </AuthLayout>
  )
}

function StepHeading({
  headingRef,
  children,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>
  children: React.ReactNode
}) {
  return (
    <h2 ref={headingRef} tabIndex={-1} className="text-h3 text-text focus-visible:outline-focus-ring">
      {children}
    </h2>
  )
}

function VerifyEmailStep({
  headingRef,
  disabled,
  onVerified,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>
  disabled: boolean
  onVerified: () => void
}) {
  const { t } = useI18n()
  const auth = useAuth()
  const [email, setEmail] = useState(auth.pendingEmail)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const codeRef = useRef<HTMLInputElement>(null)

  // Once the code is sent, the code field replaces the email form: move focus
  // into it so keyboard and screen-reader users land where they type next.
  useEffect(() => {
    if (sentTo) codeRef.current?.focus()
  }, [sentTo])

  async function sendCode(e: FormEvent) {
    e.preventDefault()
    const normalised = normaliseEmailInput(email)
    setEmailError(null)
    if (!parseEmail(normalised)) return setEmailError(t('auth.email.invalid'))
    if (!isAllowedEmail(normalised)) return setEmailError(t('auth.domainNotAllowed.title'))
    setBusy(true)
    try {
      await auth.startEmailCode(normalised)
      auth.setPendingEmail(normalised)
      setSentTo(normalised)
    } catch (err) {
      setEmailError(t(isAuthFailure(err) ? codeMessageId(err.code) : 'auth.unavailable.title'))
    } finally {
      setBusy(false)
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault()
    setCodeError(null)
    setNotice(null)
    const trimmed = code.replace(/\s+/g, '')
    if (!CODE_PATTERN.test(trimmed)) return setCodeError(t('auth.first.codeInvalid'))
    setBusy(true)
    try {
      await auth.confirmEmailCode(trimmed)
      onVerified()
    } catch (err) {
      setCodeError(t(isAuthFailure(err) ? codeMessageId(err.code) : 'auth.unavailable.title'))
      setBusy(false)
    }
  }

  async function resend() {
    setCodeError(null)
    setNotice(null)
    try {
      await auth.resendEmailCode()
      setNotice(t('auth.first.resent'))
    } catch (err) {
      setCodeError(t(isAuthFailure(err) ? codeMessageId(err.code) : 'auth.unavailable.title'))
    }
  }

  if (!sentTo) {
    return (
      <form onSubmit={sendCode} noValidate>
        <Stack gap={4}>
          <StepHeading headingRef={headingRef}>{t('auth.first.verifyTitle')}</StepHeading>
          <p className="text-body text-text-muted">{t('auth.first.emailIntro')}</p>
          <Field label={t('auth.email.label')} error={emailError ?? undefined} required>
            {(aria) => (
              <Input
                {...aria}
                type="email"
                name="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder={t('auth.email.placeholder')}
                value={email}
                invalid={Boolean(emailError)}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" loading={busy} loadingLabel={t('auth.working')} disabled={disabled}>
            {t('auth.first.sendCode')}
          </Button>
        </Stack>
      </form>
    )
  }

  return (
    <form onSubmit={verify} noValidate>
      <Stack gap={4}>
        <StepHeading headingRef={headingRef}>{t('auth.first.verifyTitle')}</StepHeading>
        <p className="text-body text-text" role="status">
          {t('auth.first.codeSent', { email: sentTo })}
        </p>
        <Field
          label={t('auth.first.codeLabel')}
          hint={t('auth.first.codeHint')}
          error={codeError ?? undefined}
          required
        >
          {(aria) => (
            <Input
              {...aria}
              ref={codeRef}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              invalid={Boolean(codeError)}
              onChange={(e) => setCode(e.target.value)}
            />
          )}
        </Field>
        {notice && (
          <Alert tone="success" live>
            {notice}
          </Alert>
        )}
        <Cluster gap={3}>
          <Button type="submit" variant="primary" loading={busy} loadingLabel={t('auth.working')}>
            {t('auth.first.verify')}
          </Button>
          <Button onClick={() => void resend()} disabled={busy}>
            {t('auth.first.resend')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setSentTo(null)
              setCode('')
              setCodeError(null)
            }}
            disabled={busy}
          >
            {t('auth.first.useDifferentEmail')}
          </Button>
        </Cluster>
      </Stack>
    </form>
  )
}

function CreatePasskeyStep({
  headingRef,
  disabled,
  onCreated,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>
  disabled: boolean
  onCreated: () => void
}) {
  const { t } = useI18n()
  const auth = useAuth()
  const [failed, setFailed] = useState<AuthFailureCode | null>(null)
  const [busy, setBusy] = useState(false)

  async function create() {
    setFailed(null)
    setBusy(true)
    try {
      await auth.registerPasskey()
      onCreated()
    } catch (err) {
      setFailed(isAuthFailure(err) ? err.code : 'passkeyFailed')
      setBusy(false)
    }
  }

  return (
    <Stack gap={4}>
      <StepHeading headingRef={headingRef}>{t('auth.first.createTitle')}</StepHeading>
      <p className="text-body text-text-muted">{t('auth.first.createIntro')}</p>
      {failed && (
        <Alert
          tone="danger"
          assertive
          title={failed === 'passkeyExists' ? t('passkeys.alreadyExists') : t('auth.first.createFailed.title')}
        >
          {failed === 'passkeyExists' ? null : t('auth.first.createFailed.description')}
        </Alert>
      )}
      <Cluster gap={3}>
        <Button variant="primary" onClick={() => void create()} loading={busy} loadingLabel={t('auth.working')} disabled={disabled}>
          {failed ? t('action.retry') : t('auth.first.create')}
        </Button>
        <Button variant="ghost" onClick={() => void auth.signOut()} disabled={busy}>
          {t('action.cancel')}
        </Button>
      </Cluster>
    </Stack>
  )
}

function GetStartedStep({ headingRef }: { headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  const { t } = useI18n()
  const { navigate } = useRouter()
  const [role, setRole] = useState<RoleCode>('PLN')
  const [inApp, setInApp] = useState(true)
  const [emailNotify, setEmailNotify] = useState(true)
  const inAppId = useId()
  const emailId = useId()

  function onContinue(e: FormEvent) {
    e.preventDefault()
    saveOnboardingChoices({ startRole: role, notifyInApp: inApp, notifyEmail: emailNotify })
    navigate(consumeReturnTo('/'), { replace: true })
  }

  return (
    <form onSubmit={onContinue}>
      <Stack gap={4}>
        <StepHeading headingRef={headingRef}>{t('auth.first.startTitle')}</StepHeading>
        <Alert tone="success" live>
          {t('auth.first.created')}
        </Alert>
        <Field label={t('auth.first.startAs')}>
          {(aria) => (
            <Select
              {...aria}
              value={role}
              onChange={(e) => {
                const next = e.target.value
                if (isRoleCode(next)) setRole(next)
              }}
            >
              {ROLE_CODES.map((code) => (
                <option key={code} value={code}>
                  {t(`role.${code}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-label text-text">{t('auth.first.notifications')}</legend>
          <Checkbox
            id={inAppId}
            label={t('auth.first.notifyInApp')}
            checked={inApp}
            onChange={(e) => setInApp(e.target.checked)}
          />
          <Checkbox
            id={emailId}
            label={t('auth.first.notifyEmail')}
            checked={emailNotify}
            onChange={(e) => setEmailNotify(e.target.checked)}
          />
        </fieldset>
        <Button type="submit" variant="primary">
          {t('auth.first.continue')}
        </Button>
      </Stack>
    </form>
  )
}
