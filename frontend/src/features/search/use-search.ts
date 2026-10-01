import type { SearchResponse } from '@lanewise/shared'
import { useCallback, useEffect, useState } from 'react'
import { useApi } from '@/api'
import { useActiveRole } from '@/app/active-role'

type Result = { key: string; data?: SearchResponse; error?: unknown }

/**
 * Runs `GET /search` for the active role (task 20). Refetches when the role,
 * query or limit changes and on `retry()`; a response for a previous role or
 * query is never shown for the current one. `debounceMs` waits for typing to
 * settle (the top-bar dropdown). An empty query is idle: no request.
 */
export function useSearch(
  query: string,
  limit: number,
  { debounceMs = 0 }: { debounceMs?: number } = {},
): { data: SearchResponse | null; error: unknown; loading: boolean; idle: boolean; retry: () => void } {
  const api = useApi()
  const { role } = useActiveRole()
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<Result | null>(null)
  const q = query.trim()
  const key = `${role}:${limit}:${attempt}:${q}`

  useEffect(() => {
    if (q.length === 0) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      api.search(q, limit, { signal: controller.signal }).then(
        (data) => {
          if (!controller.signal.aborted) setResult({ key, data })
        },
        (error: unknown) => {
          if (!controller.signal.aborted) setResult({ key, error })
        },
      )
    }, debounceMs)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [api, key, q, limit, debounceMs])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  const idle = q.length === 0
  const current = !idle && result?.key === key ? result : null
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: !idle && current === null,
    idle,
    retry,
  }
}
