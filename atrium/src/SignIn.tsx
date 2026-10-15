import { useState, type FormEvent } from 'react'
import { AuthError, type AtriumAuth, type SignedInUser } from './auth'
import { T, type Lang } from './i18n'
import { LangSwitch } from './LangSwitch'
import { Mark, Wordmark } from './Logo'

type Step = { kind: 'email' } | { kind: 'code'; destination: string | null }

export function SignIn({ auth, lang, onLang, onSignedIn }: { auth: AtriumAuth; lang: Lang; onLang: (l: Lang) => void; onSignedIn: (u: SignedInUser) => void }) {
  const t = T[lang]
  const [step, setStep] = useState<Step>({ kind: 'email' })
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      const c = err instanceof AuthError ? err.code : 'unknown'
      setError(t[`err_${c}`])
    } finally {
      setBusy(false)
    }
  }

  const sendCode = (e?: FormEvent) => {
    e?.preventDefault()
    void run(async () => {
      const out = await auth.startEmailCode(email.trim())
      setCode('')
      setStep({ kind: 'code', destination: out.destination })
    })
  }

  const passkey = () => void run(async () => onSignedIn(await auth.signInWithPasskey(email.trim())))

  const verify = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => onSignedIn(await auth.confirmEmailCode(code.trim())))
  }

  return (
    <div className="signin">
      <div className="signin-hero">
        <div className="signin-brand">
          <Mark size={56} inverse />
          <span className="wordmark inverse">
            <b>SM</b> <span>ATRIUM</span>
          </span>
        </div>
        <span className="rule" aria-hidden="true" />
        <h1>{t.tagline}</h1>
        <p>{t.signInLede}</p>
      </div>
      <main className="signin-card">
        <div className="signin-top">
          <Wordmark />
          <LangSwitch lang={lang} onChange={onLang} />
        </div>
        <h2>{t.signInTitle}</h2>
        {step.kind === 'email' ? (
          <form onSubmit={sendCode} className="stack">
            <label htmlFor="email">{t.email}</label>
            <input id="email" type="email" autoComplete="username webauthn" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@smretail.com" aria-describedby="email-hint" />
            <span id="email-hint" className="hint">{t.emailHint}</span>
            <button type="submit" className="btn primary" disabled={busy || !email}>
              {busy ? t.working : t.sendCode}
            </button>
            <button type="button" className="btn" disabled={busy || !email} onClick={passkey}>
              {t.usePasskey}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="stack">
            <p className="hint">
              {t.codeSent} <b>{step.destination ?? email}</b>
            </p>
            <label htmlFor="code">{t.code}</label>
            <input id="code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} className="mono" />
            <button type="submit" className="btn primary" disabled={busy || code.length < 6}>
              {busy ? t.working : t.verify}
            </button>
            <button type="button" className="btn link" onClick={() => setStep({ kind: 'email' })}>
              {t.back}
            </button>
          </form>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <p className="fine">{t.sample}</p>
      </main>
    </div>
  )
}
