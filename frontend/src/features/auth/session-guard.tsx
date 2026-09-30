import { useCallback, type ReactNode } from 'react'
import { useRouter } from '@/app/router'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useI18n } from '@/i18n'
import { useAuth } from './auth-context'
import { DEFAULT_IDLE_POLICY, formatCountdown, type IdlePolicy } from './idle'
import { rememberReturnTo } from './return-to'
import { useIdleTimeout } from './use-idle-timeout'

/**
 * Wraps signed-in content with the idle timeout (requirement 1.8): a warning
 * dialog 2 minutes before the 60-minute limit with "Stay signed in"; on
 * timeout the current URL is remembered, the session is revoked and the user
 * lands on SCR-001 with the "signed out after inactivity" notice.
 */
export function SessionGuard({
  children,
  policy = DEFAULT_IDLE_POLICY,
  now,
}: {
  children: ReactNode
  policy?: IdlePolicy
  now?: () => number
}) {
  const { signOut } = useAuth()
  const { href } = useRouter()

  const onTimeout = useCallback(() => {
    rememberReturnTo(href)
    void signOut('expired')
  }, [href, signOut])

  const { phase, msLeft, staySignedIn } = useIdleTimeout({
    policy,
    onTimeout,
    ...(now ? { now } : {}),
  })

  return (
    <>
      {children}
      <SessionTimeoutDialog
        open={phase === 'warning'}
        msLeft={msLeft}
        onStay={staySignedIn}
        onSignOut={() => void signOut('signedOut')}
      />
    </>
  )
}

export function SessionTimeoutDialog({
  open,
  msLeft,
  onStay,
  onSignOut,
}: {
  open: boolean
  msLeft: number
  onStay: () => void
  onSignOut: () => void
}) {
  const { t } = useI18n()
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Esc / closing the warning counts as "Stay signed in".
        if (!next) onStay()
      }}
    >
      <DialogContent role="alertdialog" hideClose>
        <DialogHeader>
          <DialogTitle>{t('session.warning.title')}</DialogTitle>
          <DialogDescription>{t('session.warning.description')}</DialogDescription>
        </DialogHeader>
        <p role="timer" className="lw-numeric text-h3 text-text">
          {t('session.warning.timeLeft', { time: formatCountdown(msLeft) })}
        </p>
        <DialogFooter>
          <Button variant="secondary" onClick={onSignOut}>
            {t('session.warning.signOut')}
          </Button>
          <Button variant="primary" onClick={onStay} autoFocus>
            {t('session.warning.stay')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
