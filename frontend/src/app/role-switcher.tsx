import { ROLE_CODES, isRoleCode } from '@lanewise/shared'
import { useId } from 'react'
import { useAnnouncer } from '@/components/a11y'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import { canStayOn } from './access'
import { useActiveRole } from './active-role'
import { useRouter } from './router'

/**
 * "Viewing as" (requirement 3.1 / 3.4). Lists all 8 roles; switching keeps
 * the current page when the new role may open it, otherwise goes Home.
 * Rendered only in demo mode.
 */
export function RoleSwitcher() {
  const { role, demo, setRole } = useActiveRole()
  const { t } = useI18n()
  const { location, navigate } = useRouter()
  const { announce } = useAnnouncer()
  const id = useId()

  if (!demo) return null

  return (
    <div className="inline-flex items-center gap-2">
      <label htmlFor={id} className="sr-only whitespace-nowrap text-label text-text-muted laptop:not-sr-only">
        {t('roleSwitcher.label')}
      </label>
      <Select
        id={id}
        value={role}
        title={t('roleSwitcher.hint')}
        className="w-auto"
        onChange={(e) => {
          const next = e.target.value
          if (!isRoleCode(next)) return
          setRole(next)
          if (!canStayOn(next, location.pathname)) navigate('/')
          announce(t('roleSwitcher.announce', { role: t(`role.${next}`) }))
        }}
      >
        {ROLE_CODES.map((code) => (
          <option key={code} value={code}>
            {t(`role.${code}`)}
          </option>
        ))}
      </Select>
    </div>
  )
}
