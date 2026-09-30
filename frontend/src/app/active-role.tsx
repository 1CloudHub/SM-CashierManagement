import type { RoleCode } from '@lanewise/shared'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { readOnboardingChoices } from '@/features/auth/onboarding'
import { DEFAULT_DEMO_ROLE, readStoredRole, storeRole } from './active-role-storage'
import { DEMO_ROLE_SWITCHER } from './config'

/**
 * The active role (requirement 3, task 8.2; design.md › Role switcher).
 *
 * Demo mode (VITE_DEMO_ROLE_SWITCHER, default on): any of the 8 roles, chosen
 * with the "Viewing as" switcher and persisted per user in localStorage. The
 * first value is the starting role picked at first sign-in (SCR-002), else
 * Planner (the wireframe default).
 *
 * Demo mode off: the switcher is hidden and the role comes from the user's
 * assignments (`assignedRoles`, served by task 8.1); with none known yet the
 * least-privileged Staff role applies.
 *
 * The role is sent with every API request (`X-Active-Role`, src/api) and the
 * server applies that role's permissions and scope (P12). Nothing here grants
 * access by itself.
 */
export interface ActiveRoleValue {
  readonly role: RoleCode
  /** Whether the "Viewing as" switcher is shown. */
  readonly demo: boolean
  setRole: (role: RoleCode) => void
  /** Reads the current role without re-rendering (for request headers). */
  getRole: () => RoleCode
}

const ActiveRoleContext = createContext<ActiveRoleValue | null>(null)

export function ActiveRoleProvider({
  children,
  userId,
  demo = DEMO_ROLE_SWITCHER,
  assignedRoles,
}: {
  children: ReactNode
  userId?: string
  demo?: boolean
  assignedRoles?: readonly RoleCode[]
}) {
  const [role, setRoleState] = useState<RoleCode>(() => {
    if (!demo) return assignedRoles?.[0] ?? 'STF'
    return readStoredRole(userId) ?? readOnboardingChoices()?.startRole ?? DEFAULT_DEMO_ROLE
  })
  // Kept in step by setRole, so request headers read the latest role even
  // before React re-renders.
  const roleRef = useRef(role)

  const setRole = useCallback(
    (next: RoleCode) => {
      if (!demo && !assignedRoles?.includes(next)) return
      roleRef.current = next
      setRoleState(next)
      storeRole(next, userId)
    },
    [demo, assignedRoles, userId],
  )
  const getRole = useCallback(() => roleRef.current, [])

  const value = useMemo(() => ({ role, demo, setRole, getRole }), [role, demo, setRole, getRole])
  return <ActiveRoleContext.Provider value={value}>{children}</ActiveRoleContext.Provider>
}

export function useActiveRole(): ActiveRoleValue {
  const ctx = useContext(ActiveRoleContext)
  if (!ctx) throw new Error('useActiveRole must be used within an ActiveRoleProvider')
  return ctx
}
