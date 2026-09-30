import { costLevelsFor, type CostLevel } from '@lanewise/shared'
import { useActiveRole } from '@/app/active-role'

/**
 * Cost visibility for the active role (task 21, requirement 25) — the same
 * shared policy the API applies (`costLevelsFor`). This only decides what to
 * render: the server has already removed every ₱ figure the role may not see
 * (and out-of-scope ones, e.g. another store's for a Store Manager), so a
 * screen must never compute or fetch cost the response didn't carry.
 */
export function useCostLevels(): readonly CostLevel[] {
  return costLevelsFor(useActiveRole().role)
}

/** Whether the active role may see ₱ figures at `level` (in its scope). */
export function useCanSeeCost(level: CostLevel): boolean {
  return useCostLevels().includes(level)
}
