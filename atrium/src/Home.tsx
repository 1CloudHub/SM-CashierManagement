import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SignedInUser } from './auth'
import { APPS, QUEUE, type AppTile, type Effect, type LiveApp, type QueueItem } from './data'
import { T, type Lang } from './i18n'
import { LangSwitch } from './LangSwitch'
import { GridMark, Icon, Mark, OutlineMark, SPARK, Wordmark } from './Logo'

type How = 'a' | 'x' | 'd'
type Status = Record<string, How>

interface Props {
  user: SignedInUser
  lang: Lang
  onLang: (l: Lang) => void
  onOpen: (app: LiveApp) => void
  onSignOut: () => void
  /** A transient message from the shell (e.g. a missing LaneWise address). */
  notice: string | null
}

const pad = (n: number) => String(n).padStart(2, '0')

export function Home({ user, lang, onLang, onOpen, onSignOut, notice }: Props) {
  const t = T[lang]
  const [status, setStatus] = useState<Status>({})
  const [hist, setHist] = useState<string[]>([])
  const [sel, setSel] = useState<string>(QUEUE[0]!.id)
  const [toast, setToast] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [cmdOpen, setCmdOpen] = useState(false)
  const [answer, setAnswer] = useState<keyof typeof t | null>(null)
  const [drawer, setDrawer] = useState(false)
  const cmd = useRef<HTMLInputElement>(null)
  const main = useRef<HTMLElement>(null)

  const open = useMemo(() => QUEUE.filter((i) => !status[i.id]), [status])
  const cur = open.find((i) => i.id === sel) ?? open[0]

  const runEffect = useCallback(
    (e: Effect | undefined) => {
      if (e?.kind === 'open') onOpen(e.app)
    },
    [onOpen],
  )

  const act = useCallback(
    (item: QueueItem, how: How) => {
      const effect = how === 'a' ? item.onPrimary : how === 'x' ? item.onAlt : item.onSecondary
      const c = item.copy[lang]
      const label = how === 'a' ? c.primary : how === 'x' ? c.alt : c.secondary
      if (!label) return
      const next = QUEUE.filter((i) => !status[i.id] && i.id !== item.id)
      const after = next.find((i) => QUEUE.indexOf(i) > QUEUE.indexOf(item)) ?? next[0]
      setStatus((s) => ({ ...s, [item.id]: how }))
      setHist((h) => [...h, item.id])
      if (after) setSel(after.id)
      setToast(`${label}: ${c.short}`)
      runEffect(effect)
    },
    [lang, runEffect, status],
  )

  const undo = useCallback(() => {
    const id = hist[hist.length - 1]
    if (!id) return
    setStatus((s) => {
      const n = { ...s }
      delete n[id]
      return n
    })
    setHist(hist.slice(0, -1))
    setSel(id)
    setToast(null)
  }, [hist])

  const openApp = useCallback(
    (app: AppTile) => {
      setDrawer(false)
      if (app.live) {
        setToast(`${t.opening} ${app.name[lang]}`)
        onOpen(app.live)
      } else {
        setToast(`${app.name[lang]} ${t.conceptToast}`)
      }
    },
    [lang, onOpen, t],
  )

  const move = useCallback(
    (d: number) => {
      const i = open.findIndex((x) => x.id === cur?.id)
      const n = open[Math.max(0, Math.min(open.length - 1, i + d))]
      if (n) setSel(n.id)
    },
    [cur, open],
  )

  // Keyboard: J/K move, A approve, Shift+A alt, D decline, Z undo, 1–0 apps, Ctrl/Cmd+K command bar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        cmd.current?.focus()
        return
      }
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'Escape') setDrawer(false)
      if (drawer) return
      const k = e.key
      if (k === 'j' || k === 'ArrowDown') {
        e.preventDefault()
        move(1)
      } else if (k === 'k' || k === 'ArrowUp') {
        e.preventDefault()
        move(-1)
      } else if (cur && k === 'a') act(cur, 'a')
      else if (cur && k === 'A') act(cur, 'x')
      else if (cur && k === 'd') act(cur, 'd')
      else if (k === 'z') undo()
      else if (/^[0-9]$/.test(k)) {
        const app = APPS[(Number(k) + 9) % 10]
        if (app) openApp(app)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [act, cur, drawer, move, openApp, undo])

  // Command bar results.
  const results = useMemo(() => {
    type R = { kind: string; label: string; hint: string; run: () => void }
    const query = q.trim().toLowerCase()
    const all: R[] = [
      ...open.map((i) => ({ kind: t.kAction, label: `${i.copy[lang].primary}: ${i.copy[lang].short}`, hint: 'A', run: () => act(i, 'a') })),
      ...APPS.map((a) => ({ kind: t.kOpen, label: a.name[lang], hint: a.live ? t.live : t.concept, run: () => openApp(a) })),
    ]
    const ask = (text: string) => () => {
      const s = text.toLowerCase()
      setAnswer(s.includes('overtime') ? 'ansOT' : ['off', 'leave', 'bukas', 'liban'].some((w) => s.includes(w)) ? 'ansOff' : 'ansDefault')
    }
    if (!query) {
      return [all[0], all.find((r) => r.label === 'LaneWise'), { kind: t.kAsk, label: t.askPrefix + t.askTry, hint: '↵', run: ask(t.askTry) }].filter(Boolean) as R[]
    }
    const hits = all.filter((r) => r.label.toLowerCase().includes(query)).slice(0, 5)
    return [...hits, { kind: t.kAsk, label: `${t.askPrefix}"${q.trim()}"`, hint: '↵', run: ask(q) }]
  }, [act, lang, open, openApp, q, t])

  const runResult = (r: (typeof results)[number] | undefined) => {
    if (!r) return
    r.run()
    setQ('')
    setCmdOpen(false)
    cmd.current?.blur()
    main.current?.focus()
  }

  const badge = (app: AppTile) => open.filter((i) => app.sources?.includes(i.src)).length
  const cleared = QUEUE.filter((i) => status[i.id])
  const totalCleared = 12 + cleared.length
  const groups = (
    [
      ['need', t.need],
      ['fyi', t.fyi],
    ] as const
  )
    .map(([g, name]) => ({ name, rows: open.filter((i) => i.group === g) }))
    .filter((g) => g.rows.length > 0)

  const initials = (user.name ?? user.email).replace(/@.*/, '').split(/[.\s_-]+/).map((p) => p[0]?.toUpperCase() ?? '').join('').slice(0, 2) || 'SM'

  return (
    <div className="app" lang={lang}>
      <header className="top">
        <a href="/" className="brand" aria-label="SM Atrium">
          <Mark size={24} />
          <Wordmark />
        </a>
        <div className="cmd-wrap">
          <div className="cmd">
            <OutlineMark />
            <label htmlFor="cmd" className="sr-only">
              {t.cmdLabel}
            </label>
            <input
              id="cmd"
              ref={cmd}
              type="text"
              autoComplete="off"
              value={q}
              placeholder={t.placeholder}
              onChange={(e) => {
                setQ(e.target.value)
                setCmdOpen(true)
              }}
              onFocus={() => setCmdOpen(true)}
              onBlur={() => window.setTimeout(() => setCmdOpen(false), 120)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setQ('')
                  setCmdOpen(false)
                  e.currentTarget.blur()
                }
                if (e.key === 'Enter') {
                  e.preventDefault()
                  runResult(results[0])
                }
              }}
            />
            <kbd>Ctrl K</kbd>
          </div>
          {cmdOpen && (
            <div className="results" role="listbox" aria-label={t.cmdLabel}>
              {results.map((r) => (
                <button key={`${r.kind}${r.label}`} type="button" role="option" aria-selected="false" className="result" onMouseDown={(e) => e.preventDefault()} onClick={() => runResult(r)}>
                  <span className="r-kind">{r.kind}</span>
                  <span className="r-label">{r.label}</span>
                  <span className="r-hint">{r.hint}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="top-right">
          <LangSwitch lang={lang} onChange={onLang} />
          <span className="who mono" title={user.email}>
            {user.email}
          </span>
          <button type="button" className="avatar" aria-label={t.signOut} title={t.signOut} onClick={onSignOut}>
            {initials}
          </button>
        </div>
      </header>

      <nav className="dock" aria-label={t.yourApps}>
        <div className="dock-head">
          <span className="label">{t.yourApps}</span>
          <span className="label faint">{t.keysApps}</span>
        </div>
        <div className="dock-grid">
          {APPS.map((a, j) => {
            const n = badge(a)
            return (
              <button key={a.id} type="button" className="app-tile" onClick={() => openApp(a)} aria-label={`${a.name[lang]} (${(j + 1) % 10})${a.live ? '' : `, ${t.concept}`}`}>
                <span className="app-ico" style={{ background: a.color }}>
                  <Icon d={a.icon} size={26} stroke="#FFFFFF" />
                  {n > 0 && <em className="badge">{n}</em>}
                  {a.live && <i className="live-dot" aria-hidden="true" />}
                </span>
                <span>{a.name[lang]}</span>
              </button>
            )
          })}
          <button type="button" className="app-tile" onClick={() => setDrawer(true)}>
            <span className="app-ico ghost">
              <GridMark />
            </span>
            <span>{t.allApps}</span>
          </button>
        </div>
      </nav>

      {answer && (
        <div className="answer" role="status">
          <span className="label teal">ATRIUM</span>
          <span className="answer-text">{t[answer]}</span>
          <button type="button" className="btn link" onClick={() => setAnswer(null)}>
            {t.close}
          </button>
        </div>
      )}

      <main ref={main} tabIndex={-1} className="body">
        <section className="queue" aria-label={t.need}>
          {groups.map((g) => (
            <div key={g.name} className="group">
              <div className="group-head">
                <span>{g.name}</span>
                <b>{pad(g.rows.length)}</b>
              </div>
              {g.rows.map((i) => {
                const selected = cur?.id === i.id
                return (
                  <button key={i.id} type="button" className={`row${selected ? ' on' : ''}`} aria-current={selected} onClick={() => setSel(i.id)}>
                    <span className="dot" aria-hidden="true" />
                    <span className="idx">{pad(open.indexOf(i) + 1)}</span>
                    <span className="row-text">
                      <span className="row-title">{i.copy[lang].short}</span>
                      <span className="row-meta">
                        {i.src}
                        {i.agent ? ` · ${i.agent}` : ''} · {i.age[lang]}
                      </span>
                    </span>
                    {i.agent && <Icon d={SPARK} size={14} stroke="var(--teal-ink)" />}
                  </button>
                )
              })}
            </div>
          ))}
          <div className="group">
            <div className="group-head">
              <span>{t.cleared}</span>
              <b>{pad(totalCleared)}</b>
            </div>
            {cleared.map((i) => (
              <div key={i.id} className="cleared">
                <s>{i.copy[lang].short}</s>
                <span className="mono">{status[i.id] === 'd' ? t.declined : t.done}</span>
              </div>
            ))}
            <span className="earlier mono">{t.earlier}</span>
          </div>
        </section>

        <section className="detail" aria-live="polite">
          {cur ? (
            <Detail item={cur} pos={`${pad(open.indexOf(cur) + 1)} / ${pad(open.length)}`} lang={lang} onAct={(how) => act(cur, how)} />
          ) : (
            <div className="empty">
              <span className="label teal">{t.emptyTag}</span>
              <h1>{t.emptyTitle}</h1>
              <button type="button" className="btn" onClick={undo}>
                {t.undoLast}
              </button>
            </div>
          )}
        </section>
      </main>

      <footer className="status">
        <span className="sync">
          <i aria-hidden="true" />
          {t.synced} {new Date().toLocaleTimeString(lang === 'fil' ? 'fil-PH' : 'en-SG', { hour: '2-digit', minute: '2-digit' })}
        </span>
        <span className="counts">
          {open.length} {t.open} · {totalCleared} {t.clearedShort}
        </span>
        {(toast ?? notice) && (
          <span className="toast" role="status">
            <span className="toast-dot">●</span>
            {toast ?? notice}
            {hist.length > 0 && (
              <button type="button" onClick={undo}>
                {t.undo}
              </button>
            )}
          </span>
        )}
        <span className="keys">
          <span>{t.kMove}</span>
          <span>{t.kApprove}</span>
          <span>{t.kDecline}</span>
          <span>{t.kCmd}</span>
        </span>
      </footer>
      <p className="sample">{t.sample}</p>

      {drawer && (
        <div className="drawer-scrim">
          <section className="drawer" role="dialog" aria-modal="true" aria-label={t.allApps}>
            <div className="drawer-head">
              <span className="label strong">
                {t.allApps.toUpperCase()} · {APPS.length}
              </span>
              <button type="button" className="icon-btn" aria-label={t.close} onClick={() => setDrawer(false)} autoFocus>
                <Icon d="M6 6l12 12M18 6L6 18" />
              </button>
            </div>
            <div className="drawer-grid">
              {APPS.map((a) => (
                <button key={a.id} type="button" className="app-tile big" onClick={() => openApp(a)}>
                  <span className="app-ico" style={{ background: a.color }}>
                    <Icon d={a.icon} size={28} stroke="#FFFFFF" />
                    {a.live && <i className="live-dot" aria-hidden="true" />}
                  </span>
                  <span>{a.name[lang]}</span>
                  <span className="label faint">{a.live ? t.live : t.concept}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function Detail({ item, pos, lang, onAct }: { item: QueueItem; pos: string; lang: Lang; onAct: (how: How) => void }) {
  const t = T[lang]
  const c = item.copy[lang]
  return (
    <div className="detail-inner">
      <div className="detail-meta mono">
        <b>{pos}</b>
        <span className="sep">|</span>
        <span>{item.src.toUpperCase()}</span>
        {item.agent && <span className="teal">· {item.agent.toUpperCase()}</span>}
        <span>· {item.age[lang]}</span>
      </div>
      <h1>{c.title}</h1>
      <p className="lede">{c.lede}</p>
      <div className="receipt">
        {c.facts.map(([k, v, hot]) => (
          <div key={k} className="line">
            <span>{k}</span>
            <i aria-hidden="true" />
            <b className={hot ? 'hot' : undefined}>{v}</b>
          </div>
        ))}
      </div>
      {item.people && c.people && (
        <div className="people">
          <span className="label">{t.canCover}</span>
          {item.people.map((p, j) => (
            <div key={p.n} className="person">
              <span className="ini mono">{p.n.replace(/\D/g, '').slice(-2)}</span>
              <span className="person-text">
                <b>{p.n}</b>
                <span>{c.people?.[j]}</span>
              </span>
              {p.best && <span className="tag">{t.bestFit}</span>}
              <span className="mono ot">
                {p.ot} {t.hLeft}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn primary" onClick={() => onAct('a')}>
          {c.primary} <kbd>A</kbd>
        </button>
        {c.alt && (
          <button type="button" className="btn" onClick={() => onAct('x')}>
            {c.alt} <kbd>⇧A</kbd>
          </button>
        )}
        {c.secondary && (
          <button type="button" className="btn" onClick={() => onAct('d')}>
            {c.secondary} <kbd>D</kbd>
          </button>
        )}
      </div>
      {c.why && (
        <p className="why">
          {t.why} {c.why}
        </p>
      )}
    </div>
  )
}
