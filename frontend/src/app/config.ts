/**
 * Build-time feature flags (task 8.2). Vite inlines `import.meta.env.VITE_*`.
 *
 *   VITE_DEMO_ROLE_SWITCHER  "Viewing as" role switcher across all 8 roles
 *                            (requirement 3). Default on; "false" hides it and
 *                            the active role comes from the user's assignments.
 *   VITE_API_MOCK            Serve API calls from the in-memory mock adapter
 *                            (src/api/mock.ts) so screens can be built before
 *                            their endpoints exist. Default on; "false" calls
 *                            the real API at the runtime-config `apiUrl`.
 */
function flag(value: unknown, fallback: boolean): boolean {
  if (typeof value !== 'string' || value.trim() === '') return fallback
  return !['false', '0', 'off', 'no'].includes(value.trim().toLowerCase())
}

export const DEMO_ROLE_SWITCHER: boolean = flag(import.meta.env.VITE_DEMO_ROLE_SWITCHER, true)
export const API_MOCK: boolean = flag(import.meta.env.VITE_API_MOCK, true)

export { flag as parseFlag }
