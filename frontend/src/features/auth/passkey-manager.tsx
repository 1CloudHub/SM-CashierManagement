import { useCallback, useEffect, useState } from 'react'
import { Section } from '@/components/layout'
import { useAnnouncer } from '@/components/a11y'
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableRowHeader,
  TableSkeleton,
  TableWrap,
} from '@/components/ui'
import { useI18n } from '@/i18n'
import { isAuthFailure, isPasskeySupported, type Passkey } from './auth-client'
import { useAuth } from './auth-context'

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; passkeys: Passkey[] }

/**
 * SCR-080 › Passkeys (requirement 1.9): list, add and remove the signed-in
 * user's passkeys. Removing the last passkey is blocked here (the control is
 * disabled with an explanation) and again in the client, which re-reads the
 * server list before deleting.
 */
export function PasskeyManager({ passkeySupported = isPasskeySupported() }: { passkeySupported?: boolean }) {
  const { t, formatDate } = useI18n()
  const { client } = useAuth()
  const { announce } = useAnnouncer()
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [confirming, setConfirming] = useState<Passkey | null>(null)
  const [removing, setRemoving] = useState(false)

  useEffect(() => {
    let cancelled = false
    client.listPasskeys().then(
      (passkeys) => !cancelled && setLoad({ state: 'ready', passkeys }),
      () => !cancelled && setLoad({ state: 'error' }),
    )
    return () => {
      cancelled = true
    }
  }, [client, reloadKey])

  const refresh = useCallback(() => setReloadKey((k) => k + 1), [])

  const nameOf = (p: Passkey) => p.name ?? t('passkeys.unnamed')

  async function add() {
    setError(null)
    setAdding(true)
    try {
      await client.registerPasskey()
      announce(t('passkeys.added'))
      refresh()
    } catch (err) {
      setError(isAuthFailure(err) && err.code === 'passkeyExists' ? t('passkeys.alreadyExists') : t('passkeys.addFailed'))
    } finally {
      setAdding(false)
    }
  }

  async function remove(passkey: Passkey) {
    setError(null)
    setRemoving(true)
    try {
      await client.removePasskey(passkey.id)
      announce(t('passkeys.removed'))
      setConfirming(null)
      refresh()
    } catch (err) {
      setConfirming(null)
      setError(isAuthFailure(err) && err.code === 'lastPasskey' ? t('passkeys.lastPasskey') : t('passkeys.removeFailed'))
    } finally {
      setRemoving(false)
    }
  }

  const passkeys = load.state === 'ready' ? load.passkeys : []
  const isLast = passkeys.length <= 1

  return (
    <Section
      title={t('passkeys.title')}
      description={t('passkeys.description')}
      actions={
        <Button
          variant="primary"
          onClick={() => void add()}
          loading={adding}
          loadingLabel={t('auth.working')}
          disabled={!passkeySupported || load.state !== 'ready'}
        >
          {t('passkeys.add')}
        </Button>
      }
    >
      {!passkeySupported && (
        <Alert tone="warning" title={t('auth.unsupported.title')}>
          {t('auth.unsupported.description')}
        </Alert>
      )}
      {error && (
        <Alert tone="danger" assertive>
          {error}
        </Alert>
      )}

      {load.state === 'loading' && <TableSkeleton columns={3} rows={2} label={t('passkeys.loading')} />}

      {load.state === 'error' && (
        <Alert
          tone="danger"
          action={
            <Button size="sm" onClick={() => {
                setLoad({ state: 'loading' })
                refresh()
              }}>
              {t('action.retry')}
            </Button>
          }
        >
          {t('passkeys.loadFailed')}
        </Alert>
      )}

      {load.state === 'ready' && (
        <>
          <TableWrap>
            <Table aria-label={t('passkeys.tableLabel')}>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>{t('passkeys.col.device')}</TableHeaderCell>
                  <TableHeaderCell>{t('passkeys.col.added')}</TableHeaderCell>
                  <TableHeaderCell>
                    <span className="sr-only">{t('passkeys.col.actions')}</span>
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {passkeys.length === 0 && <TableEmpty colSpan={3}>{t('passkeys.empty')}</TableEmpty>}
                {passkeys.map((p) => (
                  <TableRow key={p.id}>
                    <TableRowHeader>{nameOf(p)}</TableRowHeader>
                    <TableCell>{p.createdAt ? formatDate(p.createdAt) : '—'}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={t('passkeys.removeLabel', { name: nameOf(p) })}
                        aria-describedby={isLast ? 'passkeys-last-note' : undefined}
                        disabled={isLast}
                        onClick={() => setConfirming(p)}
                      >
                        {t('passkeys.remove')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrap>
          {isLast && passkeys.length === 1 && (
            <p id="passkeys-last-note" className="text-body-sm text-text-muted">
              {t('passkeys.lastPasskey')}
            </p>
          )}
        </>
      )}

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('passkeys.confirm.title')}</DialogTitle>
            <DialogDescription>
              {confirming ? t('passkeys.confirm.description', { name: nameOf(confirming) }) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirming(null)} disabled={removing}>
              {t('action.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={removing}
              loadingLabel={t('auth.working')}
              onClick={() => confirming && void remove(confirming)}
            >
              {t('passkeys.confirm.remove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  )
}
