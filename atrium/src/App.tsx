import { useCallback, useEffect, useState } from 'react'
import type { AtriumAuth, SignedInUser } from './auth'
import type { AtriumConfig } from './config'
import type { LiveApp } from './data'
import { DeckViewer } from './DeckViewer'
import { Home } from './Home'
import { loadLang, saveLang, T, type Lang } from './i18n'
import { openLaneWise } from './lanewise'
import { Mark } from './Logo'
import { SignIn } from './SignIn'

type View = { kind: 'home' } | { kind: 'deck'; id: 'proposal' | 'exec' }

export function App({ config, auth }: { config: AtriumConfig; auth: AtriumAuth }) {
  const [user, setUser] = useState<SignedInUser | null | undefined>(undefined)
  const [lang, setLangState] = useState<Lang>(loadLang)
  const [view, setView] = useState<View>({ kind: 'home' })
  const [notice, setNotice] = useState<string | null>(null)
  const t = T[lang]

  useEffect(() => {
    void auth.currentUser().then(setUser)
  }, [auth])

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    saveLang(l)
  }, [])

  const onOpen = useCallback(
    (app: LiveApp) => {
      if (app === 'lanewise') {
        if (config.laneWiseUrl) openLaneWise(config.laneWiseUrl, config.userPoolClientId)
        else setNotice(t.laneWiseMissing)
        return
      }
      setView({ kind: 'deck', id: app })
    },
    [config, t],
  )

  if (user === undefined) {
    return (
      <div className="boot" aria-busy="true">
        <Mark size={48} />
      </div>
    )
  }
  if (user === null) return <SignIn auth={auth} lang={lang} onLang={setLang} onSignedIn={setUser} />
  if (view.kind === 'deck') {
    return (
      <DeckViewer
        id={view.id}
        title={view.id === 'proposal' ? 'SM Atrium · Proposal' : 'SM Atrium · Exec summary'}
        apiUrl={config.apiUrl}
        auth={auth}
        t={t}
        onBack={() => setView({ kind: 'home' })}
      />
    )
  }
  return (
    <Home
      user={user}
      lang={lang}
      onLang={setLang}
      onOpen={onOpen}
      notice={notice}
      onSignOut={() => {
        void auth.signOut().then(() => setUser(null))
      }}
    />
  )
}
