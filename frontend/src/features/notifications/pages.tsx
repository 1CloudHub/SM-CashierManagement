import { AppLayout } from '@/app/app-layout'
import { useRouter } from '@/app/router'
import { useScreenCrumbs } from '@/app/screen-crumbs'
import { SCREEN_BY_ID } from '@/app/screens'
import { StateBlock } from '@/components/ui/state-block'
import { useI18n } from '@/i18n'
import { isNotificationFilter } from './filter'
import { NotificationsScreen } from './notifications-screen'
import { useNotificationsClient } from './use-notifications'

const SCR_040 = SCREEN_BY_ID['SCR-040']

/**
 * SCR-040 route page (task 8.2 route table, `/notifications?filter=`): the
 * selected tab lives in the URL so a filtered list can be shared or reloaded.
 */
export function NotificationsPage() {
  const { t } = useI18n()
  const client = useNotificationsClient()
  const { location, navigate } = useRouter()
  const crumbs = useScreenCrumbs(SCR_040)
  const requested = new URLSearchParams(location.search).get('filter')
  const filter = isNotificationFilter(requested) ? requested : 'all'
  return (
    <AppLayout title={t(SCR_040.titleKey)} crumbs={crumbs}>
      {client ? (
        <NotificationsScreen
          client={client}
          filter={filter}
          onFilterChange={(next) => navigate(next === 'all' ? '/notifications' : `/notifications?filter=${next}`, { replace: true })}
        />
      ) : (
        <StateBlock variant="error" title={t('notifications.error.title')} description={t('state.error.description')} />
      )}
    </AppLayout>
  )
}
