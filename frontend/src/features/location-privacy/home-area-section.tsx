import { useCallback, useEffect, useId, useState } from 'react'
import {
  MAX_TRAVEL_MIN_CHOICES,
  type BarangayRef,
  type ConsentRecord,
  type MyConsentsResponse,
  type MyHomeAreaResponse,
} from '@lanewise/shared'
import { ApiError } from '@/api'
import { useAnnouncer } from '@/components/a11y'
import { Cluster, Section, Stack } from '@/components/layout'
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
  Skeleton,
  SkeletonText,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableWrap,
} from '@/components/ui'
import { useI18n } from '@/i18n'
import { useLocationPrivacyClient } from './client-context'

type Load =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; consents: MyConsentsResponse['consents'][number]; home: MyHomeAreaResponse }

const MIN_SEARCH = 2

/**
 * SCR-080 › Home area and shift offers (task 15; requirement 12, P15).
 *
 * Opt-in consent to the versioned consent text, then a barangay picked from
 * the reference list (no free-text address can be entered), a max travel
 * time and the cross-store offers switch. "Stop sharing" withdraws consent,
 * which deletes the home area immediately on the server.
 */
export function HomeAreaSection() {
  const { t, locale, formatDate } = useI18n()
  const client = useLocationPrivacyClient()
  const { announce } = useAnnouncer()
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'consent' | 'save' | 'stop' | null>(null)
  const [confirmStop, setConfirmStop] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([client.getMyConsents(locale), client.getMyHomeArea()]).then(
      ([consents, home]) => {
        const entry = consents.consents.find((c) => c.status.purpose === 'home_area')
        if (cancelled) return
        setLoad(entry ? { state: 'ready', consents: entry, home } : { state: 'error' })
      },
      () => !cancelled && setLoad({ state: 'error' }),
    )
    return () => {
      cancelled = true
    }
  }, [client, locale, reloadKey])

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  async function agree(version: number) {
    setError(null)
    setBusy('consent')
    try {
      await client.grantConsent('home_area', version, locale)
      reload()
    } catch (err) {
      const changed = err instanceof ApiError && err.code === 'conflict'
      setError(changed ? t('homeArea.consent.changed') : t('homeArea.consent.failed'))
      if (changed) reload()
    } finally {
      setBusy(null)
    }
  }

  async function stop() {
    setError(null)
    setBusy('stop')
    try {
      await client.withdrawConsent('home_area')
      setConfirmStop(false)
      announce(t('homeArea.stopped'))
      reload()
    } catch {
      setConfirmStop(false)
      setError(t('homeArea.stopFailed'))
    } finally {
      setBusy(null)
    }
  }

  const status = load.state === 'ready' ? load.home.consent : null

  return (
    <Section
      title={t('homeArea.title')}
      description={t('homeArea.description')}
      actions={
        status?.active ? (
          <Button variant="secondary" onClick={() => setConfirmStop(true)} disabled={busy !== null}>
            {t('homeArea.stop')}
          </Button>
        ) : undefined
      }
    >
      {error && (
        <Alert tone="danger" assertive>
          {error}
        </Alert>
      )}

      {load.state === 'loading' && (
        <div role="status" aria-label={t('homeArea.loading')}>
          <Stack gap={2}>
            <Skeleton className="h-6 w-1/2" />
            <SkeletonText lines={3} />
          </Stack>
        </div>
      )}

      {load.state === 'error' && (
        <Alert
          tone="danger"
          action={
            <Button
              size="sm"
              onClick={() => {
                setLoad({ state: 'loading' })
                reload()
              }}
            >
              {t('action.retry')}
            </Button>
          }
        >
          {t('homeArea.loadFailed')}
        </Alert>
      )}

      {load.state === 'ready' && !load.home.consent.active && (
        <ConsentPrompt
          text={load.consents.text.body}
          version={load.consents.text.version}
          reconsent={load.home.consent.reconsentRequired}
          busy={busy === 'consent'}
          onAgree={(v) => void agree(v)}
        />
      )}

      {load.state === 'ready' && load.home.consent.active && (
        <Stack gap={4}>
          {load.home.consent.grantedAt && (
            <p className="text-body-sm text-text-muted">
              {t('homeArea.consent.given', {
                date: formatDate(load.home.consent.grantedAt),
                version: load.home.consent.grantedVersion ?? load.home.consent.currentVersion,
              })}
            </p>
          )}
          <HomeAreaForm
            home={load.home}
            busy={busy === 'save'}
            onSave={async (input) => {
              setError(null)
              setBusy('save')
              try {
                const home = await client.setMyHomeArea(input)
                setLoad({ ...load, home })
                announce(t('homeArea.saved'))
              } catch {
                setError(t('homeArea.saveFailed'))
              } finally {
                setBusy(null)
              }
            }}
          />
        </Stack>
      )}

      {load.state === 'ready' && load.consents.history.length > 0 && (
        <ConsentHistory history={load.consents.history} />
      )}

      <Dialog open={confirmStop} onOpenChange={(open) => !open && setConfirmStop(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('homeArea.stop.title')}</DialogTitle>
            <DialogDescription>{t('homeArea.stop.description')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirmStop(false)} disabled={busy === 'stop'}>
              {t('action.cancel')}
            </Button>
            <Button variant="danger" loading={busy === 'stop'} loadingLabel={t('auth.working')} onClick={() => void stop()}>
              {t('homeArea.stop.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  )
}

function ConsentPrompt({
  text,
  version,
  reconsent,
  busy,
  onAgree,
}: {
  text: string
  version: number
  reconsent: boolean
  busy: boolean
  onAgree: (version: number) => void
}) {
  const { t } = useI18n()
  const [read, setRead] = useState(false)
  const readId = useId()
  const headingId = useId()

  return (
    <Stack gap={3}>
      {reconsent ? (
        <Alert tone="warning" title={t('homeArea.consent.reconsent.title')}>
          {t('homeArea.consent.reconsent.description')}
        </Alert>
      ) : (
        <p className="text-body text-text-muted">{t('homeArea.notShared')}</p>
      )}
      <div role="group" aria-labelledby={headingId} className="border-2 border-outline bg-surface-2 p-4">
        <Stack gap={2}>
          <h3 id={headingId} className="text-h3 text-text">
            {t('homeArea.consent.heading')}
          </h3>
          <p className="text-body text-text">{text}</p>
          <p className="text-body-sm text-text-muted">{t('homeArea.consent.version', { version })}</p>
        </Stack>
      </div>
      <Cluster gap={2} as="label" htmlFor={readId} className="min-h-tap text-body text-text">
        <input
          id={readId}
          type="checkbox"
          className="size-5 accent-primary"
          checked={read}
          onChange={(e) => setRead(e.target.checked)}
        />
        {t('homeArea.consent.read')}
      </Cluster>
      <div>
        <Button
          variant="primary"
          disabled={!read}
          loading={busy}
          loadingLabel={t('auth.working')}
          onClick={() => onAgree(version)}
        >
          {t('homeArea.consent.agree')}
        </Button>
      </div>
    </Stack>
  )
}

function HomeAreaForm({
  home,
  busy,
  onSave,
}: {
  home: MyHomeAreaResponse
  busy: boolean
  onSave: (input: { barangayCode: string; maxTravelMin: number; crossStoreOffers: boolean }) => Promise<void>
}) {
  const { t } = useI18n()
  const client = useLocationPrivacyClient()
  const current = home.homeArea
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<BarangayRef[] | null>(null)
  const [searchFailed, setSearchFailed] = useState(false)
  const [code, setCode] = useState(current?.barangay.code ?? '')
  const [maxTravelMin, setMaxTravelMin] = useState<number>(current?.maxTravelMin ?? 30)
  const [crossStore, setCrossStore] = useState(current?.crossStoreOffers ?? false)
  const [missing, setMissing] = useState(false)
  const crossId = useId()

  useEffect(() => {
    const q = query.trim()
    if (q.length < MIN_SEARCH) return
    let cancelled = false
    client.searchBarangays(q).then(
      (found) => {
        if (cancelled) return
        setSearchFailed(false)
        setResults(found)
      },
      () => !cancelled && setSearchFailed(true),
    )
    return () => {
      cancelled = true
    }
  }, [client, query])

  // The current barangay stays selectable even when it is not in the results.
  const options = [...(query.trim().length >= MIN_SEARCH ? (results ?? []) : [])]
  if (current && !options.some((o) => o.code === current.barangay.code)) options.unshift(current.barangay)

  const travelChoices: number[] = [...MAX_TRAVEL_MIN_CHOICES]
  if (!travelChoices.includes(maxTravelMin)) travelChoices.push(maxTravelMin)

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        if (!code) {
          setMissing(true)
          return
        }
        setMissing(false)
        void onSave({ barangayCode: code, maxTravelMin, crossStoreOffers: crossStore })
      }}
    >
      <Stack gap={4}>
        {current && (
          <p className="text-body text-text">
            {t('homeArea.current', { barangay: current.barangay.name, city: current.barangay.city })}
          </p>
        )}
        <Field label={t('homeArea.barangay.search')} hint={t('homeArea.barangay.searchHint')}>
          {(aria) => (
            <Input
              {...aria}
              type="search"
              autoComplete="off"
              value={query}
              maxLength={80}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
        </Field>
        {searchFailed && <Alert tone="danger">{t('homeArea.barangay.searchFailed')}</Alert>}
        {!searchFailed && query.trim().length >= MIN_SEARCH && results?.length === 0 && (
          <p role="status" className="text-body-sm text-text-muted">
            {t('homeArea.barangay.none')}
          </p>
        )}
        <Field
          label={t('homeArea.barangay.label')}
          required
          error={missing ? t('homeArea.barangay.required') : undefined}
        >
          {(aria) => (
            <Select {...aria} value={code} invalid={missing} onChange={(e) => setCode(e.target.value)}>
              <option value="">{t('homeArea.barangay.choose')}</option>
              {options.map((b) => (
                <option key={b.code} value={b.code}>
                  {t('homeArea.barangay.option', { name: b.name, city: b.city })}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('homeArea.maxTravel.label')}>
          {(aria) => (
            <Select {...aria} value={String(maxTravelMin)} onChange={(e) => setMaxTravelMin(Number(e.target.value))}>
              {travelChoices.map((m) => (
                <option key={m} value={m}>
                  {t('homeArea.maxTravel.option', { minutes: m })}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Cluster gap={2} as="label" htmlFor={crossId} className="min-h-tap text-body text-text">
          <input
            id={crossId}
            type="checkbox"
            className="size-5 accent-primary"
            checked={crossStore}
            onChange={(e) => setCrossStore(e.target.checked)}
          />
          {t('homeArea.crossStore')}
        </Cluster>
        <div>
          <Button type="submit" variant="primary" loading={busy} loadingLabel={t('auth.working')}>
            {t('homeArea.save')}
          </Button>
        </div>
      </Stack>
    </form>
  )
}

function ConsentHistory({ history }: { history: readonly ConsentRecord[] }) {
  const { t, formatDate } = useI18n()
  return (
    <TableWrap>
      <Table aria-label={t('homeArea.history.label')}>
        <TableHead>
          <TableRow>
            <TableHeaderCell>{t('homeArea.history.col.version')}</TableHeaderCell>
            <TableHeaderCell>{t('homeArea.history.col.given')}</TableHeaderCell>
            <TableHeaderCell>{t('homeArea.history.col.ended')}</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {history.map((h) => (
            <TableRow key={h.id}>
              <TableCell>{h.textVersion}</TableCell>
              <TableCell>{formatDate(h.grantedAt)}</TableCell>
              <TableCell>
                {h.withdrawnAt === null ? (
                  <StatusPill tone="success">{t('homeArea.history.active')}</StatusPill>
                ) : (
                  `${formatDate(h.withdrawnAt)} · ${t(`homeArea.history.reason.${h.withdrawalReason ?? 'staff_withdrew'}`)}`
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableWrap>
  )
}
