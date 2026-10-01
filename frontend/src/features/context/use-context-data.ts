import type { CreateSavedViewRequest, SavedView, SavedViewScreen, UpdateSavedViewRequest } from '@lanewise/shared'
import { useCallback, useEffect, useState } from 'react'
import { useApi, type ContextOptions } from '@/api'
import { useActiveRole } from '@/app/active-role'

type Loaded<T> = { key: string; data?: T; error?: unknown }

/** Loads a resource for the active role; refetches on role change and `reload()`. */
function useLoad<T>(load: (signal: AbortSignal) => Promise<T>, dep: string) {
  const { role } = useActiveRole()
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<Loaded<T> | null>(null)
  const prefix = `${role}:${dep}:`
  const key = `${prefix}${attempt}`

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ key, data })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setResult({ key, error })
      },
    )
    return () => controller.abort()
    // `load` is recreated per render; `key` captures everything it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  const current = result?.key === key ? result : null
  // While reloading, keep showing the last data for the same role (no flicker).
  const previous = result?.key.startsWith(prefix) ? result : null
  return {
    data: current?.data ?? previous?.data ?? null,
    error: current?.error ?? null,
    loading: current === null && previous?.data === undefined,
    reload,
  }
}

/** The context bar's choices, already scope-filtered by the server (P1). */
export function useContextOptions() {
  const api = useApi()
  return useLoad<ContextOptions>((signal) => api.getContextOptions({ signal }), 'context-options')
}

/** The signed-in user's own saved views for one screen, plus the mutations (each audited server-side, P7). */
export function useSavedViews(screen: SavedViewScreen) {
  const api = useApi()
  const list = useLoad<readonly SavedView[]>(async (signal) => (await api.listSavedViews(screen, { signal })).views, screen)
  const { reload } = list
  const create = useCallback(
    async (body: Omit<CreateSavedViewRequest, 'screen'>) => {
      const view = await api.createSavedView({ ...body, screen })
      reload()
      return view
    },
    [api, screen, reload],
  )
  const update = useCallback(
    async (id: string, body: UpdateSavedViewRequest) => {
      const view = await api.updateSavedView(id, body)
      reload()
      return view
    },
    [api, reload],
  )
  const remove = useCallback(
    async (id: string) => {
      const view = await api.deleteSavedView(id)
      reload()
      return view
    },
    [api, reload],
  )
  return { ...list, create, update, remove }
}
