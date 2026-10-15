import { useEffect, useRef, useState } from 'react'
import type { AtriumAuth } from './auth'
import { ContentError, fetchContent, type ContentId } from './content'
import type { Copy } from './i18n'
import { Mark } from './Logo'

type State = { kind: 'loading' } | { kind: 'ready'; html: string } | { kind: 'error'; message: string }

/** Shows a proposal deck inside Atrium, in a sandboxed frame (scripts only, opaque origin). */
export function DeckViewer({ id, title, apiUrl, auth, t, onBack }: { id: ContentId; title: string; apiUrl: string | null; auth: AtriumAuth; t: Copy; onBack: () => void }) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const frame = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const token = await auth.accessToken()
        if (!apiUrl || !token) throw new ContentError(0)
        const html = await fetchContent(apiUrl, id, token)
        if (live) setState({ kind: 'ready', html })
      } catch (err) {
        if (live) setState({ kind: 'error', message: err instanceof ContentError && err.status === 404 ? t.notPublished : t.loadFailed })
      }
    })()
    return () => {
      live = false
    }
  }, [apiUrl, auth, id, t])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  return (
    <div className="viewer">
      <header className="viewer-bar">
        <button type="button" className="btn small" onClick={onBack}>
          ← {t.backHome}
        </button>
        <Mark size={20} />
        <span className="viewer-title">{title}</span>
        <button type="button" className="btn small" style={{ marginLeft: 'auto' }} disabled={state.kind !== 'ready'} onClick={() => void frame.current?.requestFullscreen?.()}>
          {t.fullScreen}
        </button>
      </header>
      {state.kind === 'loading' && <p className="viewer-msg">{t.loading}</p>}
      {state.kind === 'error' && (
        <p className="viewer-msg" role="alert">
          {state.message}
        </p>
      )}
      {state.kind === 'ready' && (
        <iframe
          ref={frame}
          title={title}
          className="viewer-frame"
          sandbox="allow-scripts"
          srcDoc={state.html}
          onLoad={() => frame.current?.focus()}
          allowFullScreen
        />
      )}
    </div>
  )
}
