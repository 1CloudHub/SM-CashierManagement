import type { Crumb } from '@/components/ui/breadcrumbs'
import { useI18n } from '@/i18n'
import { canAccess } from './access'
import { useActiveRole } from './active-role'
import { SCREEN_BY_ID, SECTIONS, type ScreenDef } from './screens'

/** Breadcrumbs after Home: the section (linked when the role may open it), then the title. */
export function useScreenCrumbs(screen: ScreenDef): Crumb[] {
  const { t } = useI18n()
  const { role } = useActiveRole()
  const crumbs: Crumb[] = []
  if (screen.section) {
    const section = SECTIONS[screen.section]
    const landing = SCREEN_BY_ID[section.landing]
    crumbs.push({
      label: t(section.labelKey),
      href: landing.id !== screen.id && canAccess(role, landing) ? landing.path : undefined,
    })
  }
  crumbs.push({ label: t(screen.titleKey) })
  return crumbs
}
