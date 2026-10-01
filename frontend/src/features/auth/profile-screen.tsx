import { useState } from 'react'
import { useActiveRole } from '@/app/active-role'
import { AppLayout } from '@/app/app-layout'
import { useScreenCrumbs } from '@/app/screen-crumbs'
import { SCREEN_BY_ID } from '@/app/screens'
import { useAnnouncer } from '@/components/a11y'
import { Cluster, Col, Grid, Section, Stack } from '@/components/layout'
import { Field, Pill, Select } from '@/components/ui'
import { useContextOptions } from '@/features/context/use-context-data'
import { ProfileHomeArea } from '@/features/location-privacy'
import { LanguageSwitcher, useI18n } from '@/i18n'
import { useAuth } from './auth-context'
import { readDefaultStore, storeDefaultStore } from './default-store'
import { PasskeyManager } from './passkey-manager'

/** Store hours, shifts and plan dates are all Manila time (design.md). */
const TIME_ZONE = 'Asia/Manila'

/**
 * SCR-080 Profile and preferences (wireframes/scr-080-profile.html), inside
 * the app shell: profile summary, preferences (language, default store, time
 * zone), passkeys (task 7.1, requirement 1.9) and, for Staff, home area and
 * shift offers (task 15). Notification preferences land with task 16.
 */
export function ProfileScreen() {
  const { t } = useI18n()
  const { user } = useAuth()
  const { role, demo } = useActiveRole()
  const crumbs = useScreenCrumbs(SCREEN_BY_ID['SCR-080'])
  const title = t('profile.title')

  return (
    <AppLayout title={title} crumbs={crumbs}>
      <Stack gap={6}>
        <h1 className="text-h1 text-text">{title}</h1>
        <Section title={t('profile.summary.title')}>
          <Stack as="dl" gap={3} className="text-body">
            {user?.name && <SummaryItem label={t('profile.summary.name')}>{user.name}</SummaryItem>}
            {user && <SummaryItem label={t('profile.summary.email')}>{user.email}</SummaryItem>}
            <SummaryItem label={t('profile.summary.viewingAs')}>
              <Cluster gap={2}>
                <Pill>{t(`role.${role}`)}</Pill>
                {demo && <span className="text-text-muted">{t('profile.summary.demo')}</span>}
              </Cluster>
            </SummaryItem>
          </Stack>
        </Section>
        <Section title={t('profile.prefs.title')}>
          <Grid>
            <Col span={4} spanTablet={4} spanLaptop={4}>
              <DefaultStoreSelect userId={user?.userId} />
            </Col>
            <Col span={4} spanTablet={4} spanLaptop={4}>
              <LanguageSwitcher variant="full" className="w-full" />
            </Col>
            <Col span={4} spanTablet={4} spanLaptop={4}>
              {/* Read-only per the wireframe: every store runs on Manila time. */}
              <dl>
                <SummaryItem label={t('profile.prefs.timeZone')}>{TIME_ZONE}</SummaryItem>
              </dl>
            </Col>
          </Grid>
        </Section>
        <PasskeyManager />
        <ProfileHomeArea />
      </Stack>
    </AppLayout>
  )
}

/**
 * Default store for planning screens. Choices are the stores in the active
 * role's scope (`GET /context-options`, already scope-filtered by the
 * server); the choice is saved per user in this browser (./default-store)
 * until a profile-preferences API exists.
 */
function DefaultStoreSelect({ userId }: { userId: string | undefined }) {
  const { t } = useI18n()
  const { announce } = useAnnouncer()
  const { data, error, loading } = useContextOptions()
  const [storeId, setStoreId] = useState<string>(() => readDefaultStore(userId) ?? '')
  const stores = data?.stores ?? []

  return (
    <Field
      label={t('profile.prefs.defaultStore')}
      hint={error ? t('profile.prefs.storesFailed') : undefined}
    >
      {(aria) => (
        <Select
          {...aria}
          value={storeId}
          disabled={loading && !data}
          onChange={(e) => {
            const next = e.target.value
            setStoreId(next)
            storeDefaultStore(userId, next || null)
            announce(t('profile.prefs.saved'))
          }}
        >
          <option value="">{t('profile.prefs.noDefaultStore')}</option>
          {stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))}
        </Select>
      )}
    </Field>
  )
}

/** One label/value pair of a description list. */
function SummaryItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack gap={1}>
      <dt className="text-label text-text-muted">{label}</dt>
      <dd className="text-body text-text">{children}</dd>
    </Stack>
  )
}
