import type { NotificationPreference, NotificationPreferencesResponse } from '@lanewise/shared'
import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Stack } from '@/components/layout'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { CardSkeleton } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableRowHeader } from '@/components/ui/table'
import { useI18n } from '@/i18n'
import type { NotificationsClient } from './api'
import { announceNotificationsChanged } from './use-notifications'

/**
 * Notification preferences (wireframes/_build.py SCR-080 #prefs; requirement
 * 20.3): an event-category × channel (in-app / email) grid. Approvals and
 * security notices show "Always on" instead of a checkbox. Saving sends only
 * the changed settings; the server audits the change (P7).
 */
export function PreferencesDialog({
  client,
  open,
  onOpenChange,
  onSaved,
}: {
  client: NotificationsClient
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the localised confirmation after a successful save. */
  onSaved?: (message: string) => void
}) {
  const { t } = useI18n()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('notifications.prefs.title')}</DialogTitle>
          <DialogDescription>{t('notifications.prefs.description')}</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so every opening loads fresh settings. */}
        <PreferencesForm client={client} onClose={() => onOpenChange(false)} onSaved={onSaved} />
      </DialogContent>
    </Dialog>
  )
}

function PreferencesForm({
  client,
  onClose,
  onSaved,
}: {
  client: NotificationsClient
  onClose: () => void
  onSaved?: (message: string) => void
}) {
  const { t } = useI18n()
  const [loaded, setLoaded] = useState<NotificationPreferencesResponse | null>(null)
  const [draft, setDraft] = useState<NotificationPreference[]>([])
  const [error, setError] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    client.getPreferences().then(
      (res) => {
        if (cancelled) return
        setLoaded(res)
        setDraft([...res.preferences])
      },
      () => {
        if (!cancelled) setError(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [client])

  const set = (category: NotificationPreference['category'], channel: 'inApp' | 'email', value: boolean) =>
    setDraft((prev) => prev.map((p) => (p.category === category ? { ...p, [channel]: value } : p)))

  const changes = loaded
    ? draft.flatMap((p) => {
        const before = loaded.preferences.find((b) => b.category === p.category)
        if (!before || p.locked) return []
        const change: { category: NotificationPreference['category']; inApp?: boolean; email?: boolean } = { category: p.category }
        if (p.inApp !== before.inApp) change.inApp = p.inApp
        if (p.email !== before.email) change.email = p.email
        return change.inApp === undefined && change.email === undefined ? [] : [change]
      })
    : []

  const save = async () => {
    if (changes.length === 0) {
      onClose()
      return
    }
    setSaving(true)
    setError(false)
    try {
      await client.updatePreferences({ preferences: changes })
      announceNotificationsChanged()
      onSaved?.(t('notifications.prefs.saved'))
      onClose()
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
        {error && <Alert tone="danger">{t('notifications.prefs.error')}</Alert>}
        {!loaded && !error ? (
          <CardSkeleton label={t('state.loading')} />
        ) : loaded ? (
          <Stack gap={3}>
            <div className="max-h-[60vh] overflow-auto">
              <Table aria-label={t('notifications.prefs.title')}>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell scope="col">{t('notifications.prefs.event')}</TableHeaderCell>
                    <TableHeaderCell scope="col">{t('notifications.prefs.inApp')}</TableHeaderCell>
                    <TableHeaderCell scope="col">{t('notifications.prefs.email')}</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {draft.map((p) => {
                    const label = t(`notifications.category.${p.category}`)
                    return (
                      <TableRow key={p.category}>
                        <TableRowHeader>{label}</TableRowHeader>
                        {(['inApp', 'email'] as const).map((channel) => (
                          <TableCell key={channel}>
                            {p.locked ? (
                              <span className="inline-flex items-center gap-1 text-body-sm text-text-muted">
                                <Check aria-hidden="true" className="size-4" />
                                {t('notifications.prefs.alwaysOn')}
                              </span>
                            ) : (
                              <input
                                type="checkbox"
                                className="size-5 accent-primary focus-visible:outline-focus-ring"
                                checked={p[channel]}
                                aria-label={t('notifications.prefs.toggle', {
                                  category: label,
                                  channel: t(channel === 'inApp' ? 'notifications.prefs.inApp' : 'notifications.prefs.email'),
                                })}
                                onChange={(e) => set(p.category, channel, e.target.checked)}
                              />
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            <p className="text-body-sm text-text-muted">
              {t('notifications.prefs.language', { language: t(`lang.${loaded.language}`) })}
            </p>
          </Stack>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button disabled={!loaded || saving} onClick={() => void save()}>
            {t('action.save')}
          </Button>
        </DialogFooter>
    </>
  )
}
