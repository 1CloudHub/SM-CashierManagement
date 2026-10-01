import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  STAFF_TYPES,
  WEEKDAYS,
  can,
  type RoleCode,
  type StaffListResponse,
  type StaffRecord,
  type StaffType,
  type StoreWithDepartments,
  type WeeklyAvailability,
  type Weekday,
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
import { isPlainLeftClick } from '@/app/links'
import { LocationPrivacyProvider, StaffHomeAreaPanel, type LocationPrivacyClient } from '@/features/location-privacy'
import { useI18n } from '@/i18n'
import type { MasterDataClient } from './api'
import { AvailabilityEditor } from './availability-editor'
import {
  TABLET_UP,
  UTC_DATE,
  canImport,
  dateOnly,
  failedLoad,
  importHref,
  sameAvailability,
  summarizeAvailability,
  type LoadState,
} from './logic'

export interface StaffScreenProps {
  readonly client: MasterDataClient
  readonly role: RoleCode | null
  readonly onNavigate: (href: string) => void
  /** The task 15 home-area API; when given (and the role may see home areas) the record shows the barangay panel. */
  readonly homeAreaClient?: LocationPrivacyClient
}

interface Filters {
  readonly storeId: string
  readonly departmentId: string
  readonly type: StaffType | ''
  readonly q: string
}

const NO_FILTERS: Filters = { storeId: '', departmentId: '', type: '', q: '' }

type Editing = { readonly kind: 'new' } | { readonly kind: 'edit'; readonly record: StaffRecord }

/**
 * SCR-053 Staff and availability. Staff in the active role's scope (RBAC
 * "Staff records": HR manages, the Store Manager views and edits their own
 * store, Planner and Rules Steward view), filtered by store, department, type
 * and name or staff ID. A staff ID opens the record: the weekly availability
 * grid (with "View as table"), unavailable dates and — for the own-store
 * manager and HR — the home area at barangay level only (task 15). Edits need
 * a tablet or larger; the server enforces scope and audits every change.
 */
export function StaffScreen({ client, role, onNavigate, homeAreaClient }: StaffScreenProps) {
  const { t } = useI18n()
  const { announce } = useAnnouncer()
  const tabletUp = useMediaQuery(TABLET_UP)
  const mayEditRecords = can(role, 'staff_records', 'edit')
  const mayEditAvailability = can(role, 'staff_availability', 'edit')
  const canCreate = can(role, 'staff_records', 'manage') && tabletUp
  const canEditRecords = mayEditRecords && tabletUp
  const canEditAvailability = mayEditAvailability && tabletUp

  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [load, setLoad] = useState<LoadState<StaffListResponse>>({ kind: 'loading' })
  const [stores, setStores] = useState<readonly StoreWithDepartments[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  // Filter options: the stores (and their departments) in scope.
  useEffect(() => {
    let live = true
    client.listStores().then(
      (data) => live && setStores(data.stores),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [client])

  const { storeId, departmentId, type } = filters
  useEffect(() => {
    let live = true
    client
      .listStaff({ ...(storeId ? { storeId } : {}), ...(departmentId ? { departmentId } : {}), ...(type ? { type } : {}) })
      .then(
        (data) => live && setLoad({ kind: 'ready', data }),
        (error: unknown) => live && setLoad(failedLoad(error)),
      )
    return () => {
      live = false
    }
  }, [client, storeId, departmentId, type, reloadKey])

  const setServerFilter = (next: Partial<Filters>) => {
    const merged = { ...filters, ...next }
    if (merged.storeId !== filters.storeId || merged.departmentId !== filters.departmentId || merged.type !== filters.type) {
      setLoad({ kind: 'loading' })
    }
    setFilters(merged)
  }

  const retry = useCallback(() => {
    setLoad({ kind: 'loading' })
    setReloadKey((k) => k + 1)
  }, [])

  /** Puts a changed record into the list (dialogs save without a full reload). */
  const replace = useCallback((record: StaffRecord) => {
    setLoad((l) =>
      l.kind === 'ready' ? { kind: 'ready', data: { ...l.data, staff: l.data.staff.map((s) => (s.id === record.id ? record : s)) } } : l,
    )
  }, [])

  const notify = useCallback(
    (message: string) => {
      setSaved(message)
      announce(message)
    },
    [announce],
  )

  const departments = useMemo(
    () => stores.filter((s) => !filters.storeId || s.id === filters.storeId).flatMap((s) => s.departments),
    [stores, filters.storeId],
  )
  const staff = useMemo(() => {
    if (load.kind !== 'ready') return []
    const needle = filters.q.trim().toLowerCase()
    return needle.length === 0
      ? load.data.staff
      : load.data.staff.filter((s) => s.name.toLowerCase().includes(needle) || s.employeeNo.toLowerCase().includes(needle))
  }, [load, filters.q])
  const multiStore = stores.length > 1
  const open = load.kind === 'ready' ? (load.data.staff.find((s) => s.id === openId) ?? null) : null
  const showActions = canEditRecords
  const unfiltered = !filters.q.trim() && !filters.storeId && !filters.departmentId && !filters.type

  return (
    <Stack gap={6}>
      <Cluster justify="between" align="start" gap={4}>
        <Stack gap={2}>
          <h1 className="text-h1 text-text">{t('masterData.staff.title')}</h1>
          <p className="text-body text-text-muted">{t('masterData.staff.intro')}</p>
        </Stack>
        {tabletUp && (canImport(role) || canCreate) && (
          <Cluster gap={3}>
            {canImport(role) && (
              <a
                href={importHref('staff')}
                className={buttonVariants({ variant: 'secondary' })}
                onClick={(e) => {
                  if (!isPlainLeftClick(e)) return
                  e.preventDefault()
                  onNavigate(importHref('staff'))
                }}
              >
                {t('masterData.staff.import')}
              </a>
            )}
            {canCreate && (
              <Button variant="primary" onClick={() => setEditing({ kind: 'new' })}>
                {t('masterData.staff.add')}
              </Button>
            )}
          </Cluster>
        )}
      </Cluster>

      {(mayEditRecords || mayEditAvailability) && !tabletUp && (
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

      <Cluster gap={4} align="end" role="search" aria-label={t('masterData.staff.filters')}>
        <Field label={t('masterData.filter.store')}>
          {(aria) => (
            <Select {...aria} value={filters.storeId} onChange={(e) => setServerFilter({ storeId: e.target.value, departmentId: '' })}>
              <option value="">{t('masterData.filter.allStores')}</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('masterData.filter.department')}>
          {(aria) => (
            <Select {...aria} value={filters.departmentId} onChange={(e) => setServerFilter({ departmentId: e.target.value })}>
              <option value="">{t('masterData.filter.all')}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {multiStore && !filters.storeId
                    ? t('masterData.departmentAtStore', { name: d.name, store: stores.find((s) => s.id === d.storeId)?.name ?? '' })
                    : d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('masterData.filter.type')}>
          {(aria) => (
            <Select {...aria} value={filters.type} onChange={(e) => setServerFilter({ type: e.target.value as StaffType | '' })}>
              <option value="">{t('masterData.filter.all')}</option>
              {STAFF_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(`masterData.type.${x}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('masterData.filter.searchStaff')}>
          {(aria) => <Input {...aria} type="search" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />}
        </Field>
      </Cluster>

      {load.kind === 'loading' && <TableSkeleton columns={showActions ? 9 : 8} label={t('state.loading')} />}
      {load.kind === 'error' && (
        <StateBlock
          variant="error"
          title={t('masterData.staff.error')}
          referenceId={load.referenceId}
          action={<Button onClick={retry}>{t('action.retry')}</Button>}
        />
      )}
      {load.kind === 'no-access' && (
        <StateBlock variant="no-access" title={t('state.noAccess.title')} description={t('state.noAccess.description')} />
      )}
      {load.kind === 'ready' && staff.length === 0 && (
        <StateBlock
          variant="empty"
          title={unfiltered ? t('masterData.staff.empty.title') : t('masterData.noMatches.title')}
          description={unfiltered ? t('masterData.staff.empty.description') : t('masterData.noMatches.description')}
          {...(unfiltered ? {} : { action: <Button onClick={() => setServerFilter(NO_FILTERS)}>{t('masterData.filter.clear')}</Button> })}
        />
      )}
      {load.kind === 'ready' && load.data.truncated && <Alert tone="info">{t('masterData.staff.truncated')}</Alert>}
      {load.kind === 'ready' && staff.length > 0 && (
        <StaffTable staff={staff} showStore={multiStore && !filters.storeId} showActions={showActions} onOpen={setOpenId} onEdit={(record) => setEditing({ kind: 'edit', record })} />
      )}

      <p role="note" className="text-body-sm text-text-muted">
        {t('masterData.staff.privacy')}
      </p>

      {open && (
        <StaffRecordDialog
          key={open.id}
          client={client}
          record={open}
          editable={canEditAvailability}
          homeAreaClient={can(role, 'staff_home_area', 'view') ? homeAreaClient : undefined}
          onChanged={replace}
          onNotify={notify}
          onClose={() => setOpenId(null)}
        />
      )}
      {editing && (
        <StaffFormDialog
          client={client}
          stores={stores}
          record={editing.kind === 'edit' ? editing.record : null}
          defaultStoreId={filters.storeId || stores[0]?.id || ''}
          onClose={() => setEditing(null)}
          onSaved={(record, message) => {
            setEditing(null)
            notify(message)
            if (editing.kind === 'edit') replace(record)
            else retry()
          }}
        />
      )}
    </Stack>
  )
}

function useDayName() {
  const { t } = useI18n()
  return (day: Weekday | null) => (day === null ? t('masterData.none') : t(`masterData.day.${day}`))
}

function AvailabilityText({ availability }: { availability: WeeklyAvailability }) {
  const { t } = useI18n()
  const summary = summarizeAvailability(availability)
  if (summary.kind === 'any') return <>{t('masterData.availability.any')}</>
  if (summary.kind === 'none') return <>{t('masterData.availability.none')}</>
  return (
    <>
      {t('masterData.availability.partial', { windows: summary.windows, total: summary.total })}
      <span className="block text-body-sm text-text-muted">{summary.days.map((d) => t(`masterData.day.${d}`)).join(', ')}</span>
    </>
  )
}

const MAX_DATES_SHOWN = 3

function StaffTable({
  staff,
  showStore,
  showActions,
  onOpen,
  onEdit,
}: {
  staff: readonly StaffRecord[]
  showStore: boolean
  showActions: boolean
  onOpen: (id: string) => void
  onEdit: (record: StaffRecord) => void
}) {
  const { t, formatDate } = useI18n()
  const dayName = useDayName()
  return (
    <TableWrap>
      <Table stickyFirstCol>
        <caption className="px-3 py-2 text-left text-label text-text-muted">{t('masterData.staff.caption')}</caption>
        <TableHead>
          <TableRow>
            <TableHeaderCell>{t('masterData.staff.col.id')}</TableHeaderCell>
            <TableHeaderCell>{t('masterData.staff.col.name')}</TableHeaderCell>
            <TableHeaderCell>{t('masterData.staff.col.type')}</TableHeaderCell>
            <TableHeaderCell>{t('masterData.staff.col.department')}</TableHeaderCell>
            <TableHeaderCell>{t('masterData.staff.col.rest')}</TableHeaderCell>
            <TableHeaderCell>{t('masterData.staff.col.availability')}</TableHeaderCell>
            <TableHeaderCell>{t('masterData.staff.col.unavailable')}</TableHeaderCell>
            <TableHeaderCell>{t('masterData.staff.col.active')}</TableHeaderCell>
            {showActions && <TableHeaderCell>{t('masterData.col.actions')}</TableHeaderCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {staff.map((s) => (
            <TableRow key={s.id}>
              <TableRowHeader>
                <Button size="sm" onClick={() => onOpen(s.id)}>
                  {s.employeeNo}
                  <span className="sr-only">{t('masterData.staff.openRecord', { name: s.name })}</span>
                </Button>
              </TableRowHeader>
              <TableCell>{s.name}</TableCell>
              <TableCell>{t(`masterData.type.${s.type}`)}</TableCell>
              <TableCell>
                {s.departmentName}
                {showStore && <span className="block text-body-sm text-text-muted">{s.storeName}</span>}
              </TableCell>
              <TableCell>{dayName(s.preferredRestDay)}</TableCell>
              <TableCell>
                <AvailabilityText availability={s.availability} />
              </TableCell>
              <TableCell>
                {s.unavailableDates.length === 0
                  ? t('masterData.none')
                  : s.unavailableDates
                      .slice(0, MAX_DATES_SHOWN)
                      .map((d) => formatDate(dateOnly(d.date), UTC_DATE))
                      .join(', ') +
                    (s.unavailableDates.length > MAX_DATES_SHOWN
                      ? ` ${t('masterData.staff.moreDates', { count: s.unavailableDates.length - MAX_DATES_SHOWN })}`
                      : '')}
              </TableCell>
              <TableCell>
                {s.active ? (
                  <StatusPill tone="success">{t('masterData.active')}</StatusPill>
                ) : (
                  <StatusPill tone="neutral">{t('masterData.inactive')}</StatusPill>
                )}
              </TableCell>
              {showActions && (
                <TableCell>
                  <Button size="sm" aria-label={t('masterData.editNamed', { name: s.name })} onClick={() => onEdit(s)}>
                    {t('action.edit')}
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableWrap>
  )
}

// ---------------------------------------------------------------------------
// Staff record: availability, unavailable dates, home area
// ---------------------------------------------------------------------------

function errorMessage(error: unknown, fallback: string, noAccess: string): string {
  if (error instanceof ApiError && (error.code === 'conflict' || error.code === 'validation_failed')) return error.message
  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return noAccess
  return fallback
}

function StaffRecordDialog({
  client,
  record,
  editable,
  homeAreaClient,
  onChanged,
  onNotify,
  onClose,
}: {
  client: MasterDataClient
  record: StaffRecord
  editable: boolean
  homeAreaClient: LocationPrivacyClient | undefined
  onChanged: (record: StaffRecord) => void
  onNotify: (message: string) => void
  onClose: () => void
}) {
  const { t, formatDate } = useI18n()
  const [availability, setAvailability] = useState<WeeklyAvailability>(record.availability)
  const [view, setView] = useState<'grid' | 'table'>('grid')
  const [newDate, setNewDate] = useState('')
  const [dateError, setDateError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'save' | 'add' | string | null>(null)
  const dirty = !sameAvailability(availability, record.availability)
  const failed = (e: unknown) => errorMessage(e, t('masterData.save.failed'), t('masterData.save.noAccess'))

  const save = async () => {
    setBusy('save')
    setError(null)
    try {
      const next = await client.setAvailability(record.id, availability)
      onChanged(next)
      onNotify(t('masterData.availability.saved', { id: record.employeeNo }))
      onClose()
    } catch (e) {
      setError(failed(e))
      setBusy(null)
    }
  }

  const addDate = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      setDateError(t('masterData.unavailable.dateRequired'))
      return
    }
    setDateError(null)
    setBusy('add')
    setError(null)
    try {
      const next = await client.addUnavailableDate(record.id, { date: newDate })
      onChanged(next)
      onNotify(t('masterData.unavailable.added', { date: formatDate(dateOnly(newDate), UTC_DATE) }))
      setNewDate('')
    } catch (e) {
      setDateError(failed(e))
    } finally {
      setBusy(null)
    }
  }

  const removeDate = async (entryId: string, date: string) => {
    setBusy(entryId)
    setError(null)
    try {
      const next = await client.removeUnavailableDate(record.id, entryId)
      onChanged(next)
      onNotify(t('masterData.unavailable.removed', { date: formatDate(dateOnly(date), UTC_DATE) }))
    } catch (e) {
      setError(failed(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent variant="drawer" className="overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('masterData.record.title', { id: record.employeeNo })}</DialogTitle>
          <DialogDescription>
            {t('masterData.record.description', { name: record.name, department: record.departmentName, store: record.storeName })}
          </DialogDescription>
        </DialogHeader>
        {error && <Alert tone="danger">{error}</Alert>}
        <AvailabilityEditor value={availability} view={view} onViewChange={setView} {...(editable ? { onChange: setAvailability } : {})} />

        <Stack gap={3}>
          <h3 className="text-h3 text-text">{t('masterData.unavailable.title')}</h3>
          {record.unavailableDates.length === 0 ? (
            <p className="text-body text-text-muted">{t('masterData.unavailable.none')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {record.unavailableDates.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 border border-outline-subtle px-3 py-1">
                  <span className="text-body text-text">
                    {formatDate(dateOnly(d.date), UTC_DATE)}
                    {d.reason && <span className="text-text-muted"> — {d.reason}</span>}
                    {d.source !== 'manual' && <span className="block text-body-sm text-text-muted">{t(`masterData.unavailable.source.${d.source}`)}</span>}
                  </span>
                  {editable && d.source === 'manual' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy === d.id}
                      aria-label={t('masterData.unavailable.removeNamed', { date: formatDate(dateOnly(d.date), UTC_DATE) })}
                      onClick={() => void removeDate(d.id, d.date)}
                    >
                      {t('masterData.unavailable.remove')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {editable && (
            <Cluster gap={3} align="end">
              <Field label={t('masterData.unavailable.add')} error={dateError ?? undefined}>
                {(aria) => <Input {...aria} type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />}
              </Field>
              <Button loading={busy === 'add'} onClick={() => void addDate()}>
                {t('masterData.unavailable.addButton')}
              </Button>
            </Cluster>
          )}
        </Stack>

        {homeAreaClient && (
          <LocationPrivacyProvider client={homeAreaClient}>
            <StaffHomeAreaPanel staffId={record.id} />
          </LocationPrivacyProvider>
        )}

        <p className="text-body-sm text-text-muted">{t('masterData.staff.privacy')}</p>
        <DialogFooter>
          <Button onClick={onClose}>{t('action.close')}</Button>
          {editable && (
            <Button variant="primary" disabled={!dirty} loading={busy === 'save'} loadingLabel={t('masterData.saving')} onClick={() => void save()}>
              {t('action.save')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Add / edit staff
// ---------------------------------------------------------------------------

function StaffFormDialog({
  client,
  stores,
  record,
  defaultStoreId,
  onClose,
  onSaved,
}: {
  client: MasterDataClient
  stores: readonly StoreWithDepartments[]
  record: StaffRecord | null
  defaultStoreId: string
  onClose: () => void
  onSaved: (record: StaffRecord, message: string) => void
}) {
  const { t } = useI18n()
  const [storeId, setStoreId] = useState(record?.storeId ?? defaultStoreId)
  const storeDepartments = stores.find((s) => s.id === storeId)?.departments ?? []
  const [departmentId, setDepartmentId] = useState(record?.departmentId ?? storeDepartments[0]?.id ?? '')
  const [employeeNo, setEmployeeNo] = useState('')
  const [name, setName] = useState(record?.name ?? '')
  const [type, setType] = useState<StaffType>(record?.type ?? 'full_time')
  const [rest, setRest] = useState<Weekday | ''>(record?.preferredRestDay ?? '')
  const [active, setActive] = useState(record?.active ?? true)
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const required = t('masterData.validation.required')
  const errs = {
    storeId: record === null && !storeId ? required : undefined,
    departmentId: !departmentId ? required : undefined,
    employeeNo: record === null && employeeNo.trim().length === 0 ? required : undefined,
    name: name.trim().length === 0 ? required : undefined,
  }
  const shown: Partial<typeof errs> = submitted ? errs : {}

  const save = async () => {
    setSubmitted(true)
    if (Object.values(errs).some((e) => e !== undefined)) return
    setSaving(true)
    setError(null)
    try {
      const saved =
        record === null
          ? await client.createStaff({ storeId, departmentId, employeeNo: employeeNo.trim(), name: name.trim(), type, preferredRestDay: rest || null })
          : await client.updateStaff(record.id, { name: name.trim(), type, departmentId, preferredRestDay: rest || null, active })
      onSaved(saved, record === null ? t('masterData.staff.created', { id: saved.employeeNo }) : t('masterData.staff.saved', { id: saved.employeeNo }))
    } catch (e) {
      setError(errorMessage(e, t('masterData.save.failed'), t('masterData.save.noAccess')))
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{record === null ? t('masterData.staff.addTitle') : t('masterData.staff.editTitle', { id: record.employeeNo })}</DialogTitle>
          <DialogDescription>{t('masterData.staff.privacy')}</DialogDescription>
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
            {record === null && (
              <Field label={t('masterData.filter.store')} error={shown.storeId} required>
                {(aria) => (
                  <Select
                    {...aria}
                    value={storeId}
                    onChange={(e) => {
                      setStoreId(e.target.value)
                      setDepartmentId(stores.find((s) => s.id === e.target.value)?.departments[0]?.id ?? '')
                    }}
                  >
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Field label={t('masterData.filter.department')} error={shown.departmentId} required>
              {(aria) => (
                <Select {...aria} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                  {storeDepartments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {record === null && (
              <Field label={t('masterData.staff.col.id')} hint={t('masterData.staff.idHint')} error={shown.employeeNo} required>
                {(aria) => <Input {...aria} value={employeeNo} onChange={(e) => setEmployeeNo(e.target.value)} autoComplete="off" />}
              </Field>
            )}
            <Field label={t('masterData.staff.col.name')} error={shown.name} required>
              {(aria) => <Input {...aria} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />}
            </Field>
            <Field label={t('masterData.filter.type')}>
              {(aria) => (
                <Select {...aria} value={type} onChange={(e) => setType(e.target.value as StaffType)}>
                  {STAFF_TYPES.map((x) => (
                    <option key={x} value={x}>
                      {t(`masterData.type.${x}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('masterData.staff.col.rest')}>
              {(aria) => (
                <Select {...aria} value={rest} onChange={(e) => setRest(e.target.value as Weekday | '')}>
                  <option value="">{t('masterData.staff.noRest')}</option>
                  {WEEKDAYS.map((d) => (
                    <option key={d} value={d}>
                      {t(`masterData.dayLong.${d}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {record !== null && (
              <label className="inline-flex min-h-tap items-center gap-2 text-body text-text">
                <input type="checkbox" className="size-5 accent-primary" checked={active} onChange={(e) => setActive(e.target.checked)} />
                {t('masterData.activeField')}
              </label>
            )}
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
