import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import {
  STORE_FORMATS,
  can,
  storeRollup,
  type DepartmentSummary,
  type RegionSummary,
  type RoleCode,
  type StoreFormat,
  type StoreListResponse,
  type StoreWithDepartments,
  type TradingHours,
} from '@lanewise/shared'
import { ApiError } from '@/api'
import { useAnnouncer } from '@/components/a11y'
import { Cluster, Stack, useMediaQuery } from '@/components/layout'
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
  StateBlock,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableRowHeader,
  TableSkeleton,
  TableWrap,
  buttonVariants,
} from '@/components/ui'
import { useI18n } from '@/i18n'
import { isPlainLeftClick } from '@/app/links'
import type { MasterDataClient } from './api'
import {
  NO_STORE_FILTERS,
  TABLET_UP,
  UTC_TIME,
  canImport,
  clockTime,
  failedLoad,
  filterStores,
  importHref,
  type LoadState,
  type StoreFilters,
} from './logic'

export interface StoresScreenProps {
  readonly client: MasterDataClient
  readonly role: RoleCode | null
  /** In-app navigation (the Import link to SCR-051). */
  readonly onNavigate: (href: string) => void
}

type Editing =
  | { readonly kind: 'new-store' }
  | { readonly kind: 'store'; readonly store: StoreWithDepartments }
  | { readonly kind: 'department'; readonly store: StoreWithDepartments; readonly department: DepartmentSummary }

/**
 * SCR-052 Stores, departments and lanes (master data). Stores in the active
 * role's scope, grouped store → departments, with installed lanes, the default
 * handle time and trading hours. The Rules Steward (RBAC "Stores /
 * departments / lanes": manage) adds and edits stores and departments on a
 * tablet or larger; everyone else, and every phone, gets the read-only table.
 * The server enforces the same rules (P12) and audits every edit (P7).
 */
export function StoresScreen({ client, role, onNavigate }: StoresScreenProps) {
  const { t } = useI18n()
  const { announce } = useAnnouncer()
  const tabletUp = useMediaQuery(TABLET_UP)
  const mayManage = can(role, 'master_data', 'manage')
  const editable = mayManage && tabletUp
  const [load, setLoad] = useState<LoadState<StoreListResponse>>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [filters, setFilters] = useState<StoreFilters>(NO_STORE_FILTERS)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    client.listStores().then(
      (data) => live && setLoad({ kind: 'ready', data }),
      (error: unknown) => live && setLoad(failedLoad(error)),
    )
    return () => {
      live = false
    }
  }, [client, reloadKey])

  const retry = useCallback(() => {
    setLoad({ kind: 'loading' })
    setReloadKey((k) => k + 1)
  }, [])

  const onSaved = useCallback(
    (message: string) => {
      setEditing(null)
      setSaved(message)
      announce(message)
      setReloadKey((k) => k + 1)
    },
    [announce],
  )

  const visible = useMemo(() => (load.kind === 'ready' ? filterStores(load.data.stores, filters) : []), [load, filters])
  const regions = load.kind === 'ready' ? load.data.regions : []

  return (
    <Stack gap={6}>
      <Cluster justify="between" align="start" gap={4}>
        <Stack gap={2}>
          <h1 className="text-h1 text-text">{t('masterData.stores.title')}</h1>
          <p className="text-body text-text-muted">{t('masterData.stores.intro')}</p>
        </Stack>
        {editable && (
          <Cluster gap={3}>
            {canImport(role) && (
              <a
                href={importHref('master')}
                className={buttonVariants({ variant: 'secondary' })}
                onClick={(e) => {
                  if (!isPlainLeftClick(e)) return
                  e.preventDefault()
                  onNavigate(importHref('master'))
                }}
              >
                {t('masterData.stores.import')}
              </a>
            )}
            <Button variant="primary" onClick={() => setEditing({ kind: 'new-store' })}>
              {t('masterData.stores.add')}
            </Button>
          </Cluster>
        )}
      </Cluster>

      {mayManage && !tabletUp && (
        <p role="note" className="text-body-sm text-text-muted">
          {t('masterData.readOnlyPhone')}
        </p>
      )}
      {saved && (
        <Alert
          tone="success"
          live={false}
          action={
            <Button size="sm" variant="ghost" onClick={() => setSaved(null)}>
              {t('masterData.dismiss')}
            </Button>
          }
        >
          {saved}
        </Alert>
      )}

      <Cluster gap={4} align="end" role="search" aria-label={t('masterData.stores.filters')}>
        <Field label={t('masterData.filter.search')}>
          {(aria) => (
            <Input {...aria} type="search" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
          )}
        </Field>
        <Field label={t('masterData.filter.region')}>
          {(aria) => (
            <Select {...aria} value={filters.regionId} onChange={(e) => setFilters({ ...filters, regionId: e.target.value })}>
              <option value="">{t('masterData.filter.all')}</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('masterData.filter.format')}>
          {(aria) => (
            <Select
              {...aria}
              value={filters.format}
              onChange={(e) => setFilters({ ...filters, format: e.target.value as StoreFormat | '' })}
            >
              <option value="">{t('masterData.filter.all')}</option>
              {STORE_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {t(`masterData.format.${f}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </Cluster>

      {load.kind === 'loading' && <TableSkeleton columns={editable ? 8 : 7} label={t('state.loading')} />}
      {load.kind === 'error' && (
        <StateBlock
          variant="error"
          title={t('masterData.stores.error')}
          referenceId={load.referenceId}
          action={<Button onClick={retry}>{t('action.retry')}</Button>}
        />
      )}
      {load.kind === 'no-access' && (
        <StateBlock variant="no-access" title={t('state.noAccess.title')} description={t('state.noAccess.description')} />
      )}
      {load.kind === 'ready' && load.data.stores.length === 0 && (
        <StateBlock variant="empty" title={t('masterData.stores.empty.title')} description={t('masterData.stores.empty.description')} />
      )}
      {load.kind === 'ready' && load.data.stores.length > 0 && visible.length === 0 && (
        <StateBlock
          variant="empty"
          title={t('masterData.noMatches.title')}
          description={t('masterData.noMatches.description')}
          action={<Button onClick={() => setFilters(NO_STORE_FILTERS)}>{t('masterData.filter.clear')}</Button>}
        />
      )}
      {load.kind === 'ready' && visible.length > 0 && (
        <StoresTable stores={visible} editable={editable} onEdit={setEditing} />
      )}

      {editing?.kind === 'new-store' && (
        <StoreDialog client={client} regions={regions} store={null} onClose={() => setEditing(null)} onSaved={onSaved} />
      )}
      {editing?.kind === 'store' && (
        <StoreDialog client={client} regions={regions} store={editing.store} onClose={() => setEditing(null)} onSaved={onSaved} />
      )}
      {editing?.kind === 'department' && (
        <DepartmentDialog
          client={client}
          store={editing.store}
          department={editing.department}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </Stack>
  )
}

function ActivePill({ active }: { active: boolean }) {
  const { t } = useI18n()
  return active ? (
    <StatusPill tone="success">{t('masterData.active')}</StatusPill>
  ) : (
    <StatusPill tone="neutral">{t('masterData.inactive')}</StatusPill>
  )
}

function useHoursLabel() {
  const { t, formatTime } = useI18n()
  return (hours: TradingHours | null) =>
    hours === null
      ? t('masterData.none')
      : t('masterData.hoursRange', { open: formatTime(clockTime(hours.open), UTC_TIME), close: formatTime(clockTime(hours.close), UTC_TIME) })
}

function StoresTable({
  stores,
  editable,
  onEdit,
}: {
  stores: readonly StoreWithDepartments[]
  editable: boolean
  onEdit: (editing: Editing) => void
}) {
  const { t, formatNumber } = useI18n()
  const hoursLabel = useHoursLabel()
  return (
    <TableWrap>
      <Table stickyFirstCol>
        <caption className="px-3 py-2 text-left text-label text-text-muted">
          {t('masterData.stores.caption')}
        </caption>
        <TableHead>
          <TableRow>
            <TableHeaderCell>{t('masterData.stores.col.name')}</TableHeaderCell>
            <TableHeaderCell>{t('masterData.stores.col.format')}</TableHeaderCell>
            <TableHeaderCell>{t('masterData.stores.col.region')}</TableHeaderCell>
            <TableHeaderCell numeric>{t('masterData.stores.col.lanes')}</TableHeaderCell>
            <TableHeaderCell numeric>{t('masterData.stores.col.handleTime')}</TableHeaderCell>
            <TableHeaderCell>{t('masterData.stores.col.hours')}</TableHeaderCell>
            <TableHeaderCell>{t('masterData.stores.col.active')}</TableHeaderCell>
            {editable && <TableHeaderCell>{t('masterData.col.actions')}</TableHeaderCell>}
          </TableRow>
        </TableHead>
        {stores.map((store) => {
          const rollup = storeRollup(store.departments)
          return (
            <TableBody key={store.id}>
              <TableRow className="bg-surface-2">
                <TableRowHeader className="font-weight-semibold">
                  {store.name}
                  <span className="block text-body-sm font-weight-regular text-text-muted">{store.code}</span>
                </TableRowHeader>
                <TableCell>{t(`masterData.format.${store.format}`)}</TableCell>
                <TableCell>{store.regionName}</TableCell>
                <TableCell numeric>{formatNumber(rollup.installedLanes)}</TableCell>
                <TableCell numeric>
                  <span aria-hidden="true">{t('masterData.none')}</span>
                  <span className="sr-only">{t('masterData.notApplicable')}</span>
                </TableCell>
                <TableCell>{hoursLabel(rollup.tradingHours)}</TableCell>
                <TableCell>
                  <ActivePill active={store.active} />
                </TableCell>
                {editable && (
                  <TableCell>
                    <Button size="sm" aria-label={t('masterData.editNamed', { name: store.name })} onClick={() => onEdit({ kind: 'store', store })}>
                      {t('action.edit')}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
              {store.departments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={editable ? 8 : 7} className="pl-8 text-text-muted">
                    {t('masterData.stores.noDepartments')}
                  </TableCell>
                </TableRow>
              )}
              {store.departments.map((d) => (
                <TableRow key={d.id}>
                  <TableRowHeader className="pl-8 font-weight-regular">
                    {d.name}
                    <span className="sr-only">, {store.name}</span>
                  </TableRowHeader>
                  <TableCell />
                  <TableCell />
                  <TableCell numeric>{formatNumber(d.installedLanes)}</TableCell>
                  <TableCell numeric>{t('masterData.minutes', { value: formatNumber(d.defaultHandleTimeMin, { maximumFractionDigits: 2 }) })}</TableCell>
                  <TableCell>{hoursLabel(d.tradingHours)}</TableCell>
                  <TableCell>
                    <ActivePill active={d.active} />
                  </TableCell>
                  {editable && (
                    <TableCell>
                      <Button
                        size="sm"
                        aria-label={t('masterData.editDepartment', { name: d.name, store: store.name })}
                        onClick={() => onEdit({ kind: 'department', store, department: d })}
                      >
                        {t('action.edit')}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          )
        })}
      </Table>
    </TableWrap>
  )
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

/** Server error → a message for the dialog's alert (validation and conflict messages are safe to show). */
function useSaveError() {
  const { t } = useI18n()
  return (error: unknown): string =>
    error instanceof ApiError && (error.code === 'conflict' || error.code === 'validation_failed')
      ? error.message
      : error instanceof ApiError && (error.status === 403 || error.status === 404)
        ? t('masterData.save.noAccess')
        : t('masterData.save.failed')
}

function CheckboxField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId()
  return (
    <Cluster gap={2} as="label" htmlFor={id} className="min-h-tap text-body text-text">
      <input id={id} type="checkbox" className="size-5 accent-primary" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </Cluster>
  )
}

function StoreDialog({
  client,
  regions,
  store,
  onClose,
  onSaved,
}: {
  client: MasterDataClient
  regions: readonly RegionSummary[]
  store: StoreWithDepartments | null
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { t } = useI18n()
  const saveError = useSaveError()
  const [code, setCode] = useState('')
  const [name, setName] = useState(store?.name ?? '')
  const [format, setFormat] = useState<StoreFormat>(store?.format ?? 'sm_supermarket')
  const [regionId, setRegionId] = useState(store?.regionId ?? regions[0]?.id ?? '')
  const [active, setActive] = useState(store?.active ?? true)
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const codeError = store === null && submitted && code.trim().length === 0 ? t('masterData.validation.required') : undefined
  const nameError = submitted && name.trim().length === 0 ? t('masterData.validation.required') : undefined
  const regionError = store === null && submitted && regionId === '' ? t('masterData.validation.required') : undefined

  const save = async () => {
    setSubmitted(true)
    if (name.trim().length === 0 || (store === null && (code.trim().length === 0 || regionId === ''))) return
    setSaving(true)
    setError(null)
    try {
      if (store === null) {
        await client.createStore({ code: code.trim(), name: name.trim(), format, regionId })
        onSaved(t('masterData.store.created', { name: name.trim() }))
      } else {
        await client.updateStore(store.id, { name: name.trim(), format, active })
        onSaved(t('masterData.store.saved', { name: name.trim() }))
      }
    } catch (e) {
      setError(saveError(e))
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{store === null ? t('masterData.store.addTitle') : t('masterData.store.editTitle', { name: store.name })}</DialogTitle>
          <DialogDescription>{t('masterData.store.description')}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <Stack gap={4}>
            {error && <Alert tone="danger">{error}</Alert>}
            {store === null && (
              <Field label={t('masterData.store.code')} hint={t('masterData.store.codeHint')} error={codeError} required>
                {(aria) => <Input {...aria} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />}
              </Field>
            )}
            <Field label={t('masterData.store.name')} error={nameError} required>
              {(aria) => <Input {...aria} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />}
            </Field>
            <Field label={t('masterData.filter.format')}>
              {(aria) => (
                <Select {...aria} value={format} onChange={(e) => setFormat(e.target.value as StoreFormat)}>
                  {STORE_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {t(`masterData.format.${f}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {store === null && (
              <Field label={t('masterData.filter.region')} error={regionError} required>
                {(aria) => (
                  <Select {...aria} value={regionId} onChange={(e) => setRegionId(e.target.value)}>
                    {regions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            {store !== null && <CheckboxField label={t('masterData.activeField')} checked={active} onChange={setActive} />}
            <DialogFooter>
              <Button onClick={onClose}>{t('action.cancel')}</Button>
              <Button type="submit" variant="primary" loading={saving} loadingLabel={t('masterData.saving')}>
                {t('action.save')}
              </Button>
            </DialogFooter>
          </Stack>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DepartmentDialog({
  client,
  store,
  department,
  onClose,
  onSaved,
}: {
  client: MasterDataClient
  store: StoreWithDepartments
  department: DepartmentSummary
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { t } = useI18n()
  const saveError = useSaveError()
  const [name, setName] = useState(department.name)
  const [lanes, setLanes] = useState(String(department.installedLanes))
  const [handleTime, setHandleTime] = useState(String(department.defaultHandleTimeMin))
  const [open, setOpen] = useState(department.tradingHours.open)
  const [close, setClose] = useState(department.tradingHours.close)
  const [active, setActive] = useState(department.active)
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const lanesValue = Number(lanes)
  const handleValue = Number(handleTime)
  const errorsNow = {
    name: name.trim().length === 0 ? t('masterData.validation.required') : undefined,
    lanes:
      lanes.trim() === '' || !Number.isInteger(lanesValue) || lanesValue < 0 || lanesValue > 500
        ? t('masterData.validation.lanes')
        : undefined,
    handleTime:
      handleTime.trim() === '' || !Number.isFinite(handleValue) || handleValue <= 0 || handleValue > 60
        ? t('masterData.validation.handleTime')
        : undefined,
    close: !open || !close || close <= open ? t('masterData.validation.hours') : undefined,
  }
  const shown = submitted ? errorsNow : { name: undefined, lanes: undefined, handleTime: undefined, close: undefined }

  const save = async () => {
    setSubmitted(true)
    if (Object.values(errorsNow).some((e) => e !== undefined)) return
    setSaving(true)
    setError(null)
    try {
      await client.updateDepartment(department.id, {
        name: name.trim(),
        installedLanes: lanesValue,
        defaultHandleTimeMin: handleValue,
        tradingHours: { open, close },
        active,
      })
      onSaved(t('masterData.department.saved', { name: name.trim(), store: store.name }))
    } catch (e) {
      setError(saveError(e))
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('masterData.department.editTitle', { name: department.name })}</DialogTitle>
          <DialogDescription>{t('masterData.department.description', { store: store.name })}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <Stack gap={4}>
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label={t('masterData.department.name')} error={shown.name} required>
              {(aria) => <Input {...aria} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />}
            </Field>
            <Field label={t('masterData.stores.col.lanes')} error={shown.lanes} required>
              {(aria) => (
                <Input {...aria} type="number" inputMode="numeric" min={0} max={500} step={1} value={lanes} onChange={(e) => setLanes(e.target.value)} />
              )}
            </Field>
            <Field label={t('masterData.department.handleTime')} hint={t('masterData.department.handleTimeHint')} error={shown.handleTime} required>
              {(aria) => (
                <Input {...aria} type="number" inputMode="decimal" min={0.1} max={60} step={0.1} value={handleTime} onChange={(e) => setHandleTime(e.target.value)} />
              )}
            </Field>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-label text-text">{t('masterData.stores.col.hours')}</legend>
              <Cluster gap={4} align="start">
                <Field label={t('masterData.department.opens')} required>
                  {(aria) => <Input {...aria} type="time" value={open} onChange={(e) => setOpen(e.target.value)} />}
                </Field>
                <Field label={t('masterData.department.closes')} error={shown.close} required>
                  {(aria) => <Input {...aria} type="time" value={close} onChange={(e) => setClose(e.target.value)} />}
                </Field>
              </Cluster>
            </fieldset>
            <CheckboxField label={t('masterData.activeField')} checked={active} onChange={setActive} />
            <DialogFooter>
              <Button onClick={onClose}>{t('action.cancel')}</Button>
              <Button type="submit" variant="primary" loading={saving} loadingLabel={t('masterData.saving')}>
                {t('action.save')}
              </Button>
            </DialogFooter>
          </Stack>
        </form>
      </DialogContent>
    </Dialog>
  )
}
