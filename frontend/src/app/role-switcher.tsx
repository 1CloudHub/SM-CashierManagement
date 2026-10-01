import { ROLE_CODES, isRoleCode } from '@lanewise/shared'
import { useId } from 'react'
import { useAnnouncer } from '@/components/a11y'
import { cn } from '@/lib/utils'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import { canStayOn } from './access'
import { useActiveRole } from './active-role'
import { useRouter } from './router'

/**
 * "Viewing as" (requirement 3.1 / 3.4). Lists all 8 roles; switching keeps
 * the current page when the new role may open it, otherwise goes Home.
 * Rendered only in demo mode.
 *
 * `bar` (top bar, tablet up): the visible label shows from laptop up and is
 * screen-reader-only below it to save room. `menu` (inside the account menu on
 * narrow screens): label stacked above a full-width select.
 */
export function RoleSwitcher({ variant = 'bar' }: { variant?: 'bar' | 'menu' } = {}) {
  const { role, demo, setRole } = useActiveRole()
  const { t } = useI18n()
  const { location, navigate } = useRouter()
  const { announce } = useAnnouncer()
  const id = useId()

  if (!demo) return null

  return (
    <div className={cn(variant === 'menu' ? 'flex flex-col gap-1' : 'inline-flex items-center gap-2')}>
      <label
        htmlFor={id}
        className={cn(
          'whitespace-nowrap text-label text-text-muted',
          variant === 'bar' && 'sr-only laptop:not-sr-only',
        )}
      >
        {t('roleSwitcher.label')}
      </label>
      <Select
        id={id}
        value={role}
        title={t('roleSwitcher.hint')}
        className={variant === 'menu' ? undefined : 'w-auto'}
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
