import type { RoleCode } from '@lanewise/shared'
import { useCallback, useEffect, useState } from 'react'
import { useApi, type HomeSummary } from '@/api'
import { useActiveRole } from '@/app/active-role'

type Result = { key: string; data?: HomeSummary; error?: unknown }

/**
 * Loads `GET /home` for the active role; refetches when the role changes
 * (requirement 3.2) and on `retry()`. A response for a previous role is
 * never shown for the current one.
 */
export function useHome(): {
  role: RoleCode
  data: HomeSummary | null
  error: unknown
  loading: boolean
  retry: () => void
} {
  const api = useApi()
  const { role } = useActiveRole()
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<Result | null>(null)
  const key = `${role}:${attempt}`

  useEffect(() => {
    const controller = new AbortController()
    api.getHome({ signal: controller.signal }).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ key, data })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setResult({ key, error })
      },
    )
    return () => controller.abort()
  }, [api, key])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  const current = result?.key === key ? result : null
  return {
    role,
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: current === null,
    retry,
  }
}
