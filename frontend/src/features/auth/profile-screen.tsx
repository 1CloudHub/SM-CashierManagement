import { UserRound } from 'lucide-react'
import { AppLink } from '@/app/router'
import { AppShell, Stack } from '@/components/layout'
import { Button, buttonVariants } from '@/components/ui'
import { LanguageSwitcher, useI18n } from '@/i18n'
import { useAuth } from './auth-context'
import { useDocumentTitle } from './use-document-title'
import { PasskeyManager } from './passkey-manager'

/**
 * Account controls for the top bar: a link to Profile (passkeys) and Sign
 * out. Stands in for the full user menu until the app shell lands.
 */
export function AccountMenu() {
  const { t } = useI18n()
  const { signOut } = useAuth()
  return (
    <>
      <AppLink
        href="/profile"
        aria-label={t('profile.nav.profile')}
        title={t('profile.nav.profile')}
        className={buttonVariants({ variant: 'ghost', size: 'icon' })}
      >
        <UserRound aria-hidden="true" className="size-5" />
      </AppLink>
      <Button size="sm" onClick={() => void signOut()}>
        {t('profile.signOut')}
      </Button>
    </>
  )
}

/**
 * SCR-080 Profile and preferences — the passkeys section (task 7.1,
 * requirement 1.9). The remaining SCR-080 sections (default scope, home area,
 * notification preferences) land with their features.
 */
export function ProfileScreen() {
  const { t } = useI18n()
  const { user } = useAuth()
  useDocumentTitle(t('profile.pageTitle'))

  return (
    <AppShell
      nav={[
        {
          title: t('profile.nav.label'),
          items: [
            { label: t('profile.nav.home'), href: '/', icon: '⌂' },
            { label: t('profile.nav.profile'), href: '/profile', icon: 'P', current: true },
          ],
        },
      ]}
      navLabel={t('profile.nav.label')}
      mainLabel={t('a11y.mainContent')}
      skipLinkLabel={t('a11y.skipToMain')}
      trailing={
        <>
          <LanguageSwitcher />
          <AccountMenu />
        </>
      }
    >
      <Stack gap={6}>
        <div>
          <h1 className="text-h1 text-text">{t('profile.title')}</h1>
          {user && <p className="mt-1 text-body text-text-muted">{t('profile.signedInAs', { email: user.email })}</p>}
        </div>
        <PasskeyManager />
      </Stack>
    </AppShell>
  )
}
