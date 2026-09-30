import { useCallback, useEffect, useState } from 'react'
import type { StaffHomeAreaResponse } from '@lanewise/shared'
import { ApiError } from '@/api'
import { Section, Stack } from '@/components/layout'
import { Alert, Button, SkeletonText, StateBlock } from '@/components/ui'
import { useI18n } from '@/i18n'
import { useLocationPrivacyClient } from './client-context'

type Load =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'no-access' }
  | { state: 'ready'; data: StaffHomeAreaResponse }

/**
 * SCR-053 › staff record › Home area (task 15; requirement 12.4/12.5).
 * For the staff member's own store manager and HR: the barangay (never
 * anything finer), max travel and the cross-store switch — or "Not shared",
 * with nothing about any earlier home area.
 */
export function StaffHomeAreaPanel({ staffId }: { staffId: string }) {
  const { t } = useI18n()
  const client = useLocationPrivacyClient()
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    client.getStaffHomeArea(staffId).then(
      (data) => !cancelled && setLoad({ state: 'ready', data }),
      (err: unknown) => {
        if (cancelled) return
        const denied = err instanceof ApiError && (err.status === 403 || err.status === 404)
        setLoad({ state: denied ? 'no-access' : 'error' })
      },
    )
    return () => {
      cancelled = true
    }
  }, [client, staffId, reloadKey])

  const retry = useCallback(() => {
    setLoad({ state: 'loading' })
    setReloadKey((k) => k + 1)
  }, [])

  return (
    <Section title={t('staffHomeArea.title')} titleAs="h3" description={t('staffHomeArea.privacyNote')}>
      {load.state === 'loading' && (
        <div role="status" aria-label={t('staffHomeArea.loading')}>
          <SkeletonText lines={3} />
        </div>
      )}
      {load.state === 'error' && (
        <Alert tone="danger" action={<Button size="sm" onClick={retry}>{t('action.retry')}</Button>}>
          {t('staffHomeArea.loadFailed')}
        </Alert>
      )}
      {load.state === 'no-access' && <StateBlock variant="no-access" title={t('staffHomeArea.noAccess')} />}
      {load.state === 'ready' && !load.data.shared && (
        <p className="text-body text-text-muted">{t('staffHomeArea.notShared')}</p>
      )}
      {load.state === 'ready' && load.data.shared && (
        <Stack gap={2} as="dl" className="text-body">
          <div>
            <dt className="text-label text-text-muted">{t('staffHomeArea.barangay')}</dt>
            <dd className="text-text">
              {t('homeArea.barangay.option', { name: load.data.barangay.name, city: load.data.barangay.city })}
            </dd>
          </div>
          <div>
            <dt className="text-label text-text-muted">{t('staffHomeArea.maxTravel')}</dt>
            <dd className="text-text">{t('homeArea.maxTravel.option', { minutes: load.data.maxTravelMin })}</dd>
          </div>
          <div>
            <dt className="text-label text-text-muted">{t('staffHomeArea.crossStore')}</dt>
            <dd className="text-text">{load.data.crossStoreOffers ? t('staffHomeArea.yes') : t('staffHomeArea.no')}</dd>
          </div>
        </Stack>
      )}
    </Section>
  )
}
