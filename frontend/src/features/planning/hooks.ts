import { useEffect, useState } from 'react'
import type { PlanningJob } from '@lanewise/shared'
import { useAnnouncer } from '@/components/a11y'
import { errorReference } from '@/features/scenarios/api'
import { useI18n } from '@/i18n'
import type { PlanningClient } from './api'
import { DATE_FORMAT } from './logic'

/** Hooks shared by the planning screens (task 14): loading, scenario resolution, job polling. */

export type Loaded<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly code: string | null; readonly referenceId?: string }
  | { readonly kind: 'ready'; readonly data: T }

/** Loads `load()` whenever `key` changes (`null` key: nothing to load). */
export function useLoaded<T>(key: string | null, load: () => Promise<T>): [Loaded<T> | null, () => void] {
  const [state, setState] = useState<{ key: string; value: Loaded<T> } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const full = key === null ? null : `${key}#${attempt}`
  useEffect(() => {
    if (full === null) return
    let live = true
    load().then(
      (data) => live && setState({ key: full, value: { kind: 'ready', data } }),
      (error: unknown) =>
        live &&
        setState({
          key: full,
          value: { kind: 'error', code: (error as { code?: string } | null)?.code ?? null, referenceId: errorReference(error) },
        }),
    )
    return () => {
      live = false
    }
    // `load` is recreated per render; `full` captures what it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full])
  if (full === null) return [null, () => undefined]
  const current = state?.key === full ? state.value : null
  // While reloading the same view, keep the last data (no flicker).
  const previous = state && state.key.startsWith(`${key}#`) && state.value.kind === 'ready' ? state.value : null
  return [current ?? previous ?? { kind: 'loading' }, () => setAttempt((n) => n + 1)]
}

/**
 * The scenario a planning screen shows: the URL's `scenario`, else the
 * published plan (the context bar's "Current published plan"), else the
 * newest scenario the role may open.
 */
export function useScenarioId(client: PlanningClient, fromUrl: string | undefined): { id: string | null; resolving: boolean } {
  const [fallback, setFallback] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    if (fromUrl) return
    let live = true
    client.scenarios().then(
      (list) => live && setFallback((list.find((s) => s.isPublished) ?? list[0])?.id ?? null),
      () => live && setFallback(null),
    )
    return () => {
      live = false
    }
  }, [client, fromUrl])
  if (fromUrl) return { id: fromUrl, resolving: false }
  return { id: fallback ?? null, resolving: fallback === undefined }
}

/** Polls a running job until it finishes, then calls `onDone` once. */
export function usePolledJob(
  job: PlanningJob | null,
  poll: (job: PlanningJob) => Promise<PlanningJob>,
  onDone: (job: PlanningJob) => void,
  intervalMs = 1500,
): PlanningJob | null {
  // The polled state belongs to the job it started from; a new `job` resets it.
  const [polled, setPolled] = useState<{ readonly from: PlanningJob | null; readonly job: PlanningJob | null }>({ from: job, job })
  const current = polled.from === job ? polled.job : job
  const { announce } = useAnnouncer()
  const { t } = useI18n()
  const active = current !== null && (current.status === 'queued' || current.status === 'running')
  useEffect(() => {
    if (!active || current === null) return
    let live = true
    const timer = setTimeout(() => {
      poll(current).then(
        (next) => {
          if (!live) return
          setPolled({ from: job, job: next })
          if (next.status === 'succeeded' || next.status === 'failed') {
            announce(t(next.status === 'succeeded' ? 'planning.job.done' : 'planning.job.failed'), next.status === 'failed' ? 'assertive' : 'polite')
            onDone(next)
          }
        },
        () => undefined,
      )
    }, intervalMs)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // Re-arm on every progress step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, current?.unitsDone, current?.status])
  return current
}

/** The date a view is for, as a heading chip. */
export function useDayText(): (date: string) => string {
  const { formatDate } = useI18n()
  return (date) => formatDate(`${date}T00:00:00Z`, { ...DATE_FORMAT, dateStyle: undefined, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}
