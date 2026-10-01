import {
  AVAILABILITY_WINDOWS,
  CLOCK_TIME_PATTERN,
  FULL_AVAILABILITY,
  HTTP_STATUS_BY_ERROR_CODE,
  STAFF_TYPES,
  STORE_FORMATS,
  WEEKDAYS,
  can,
  type ApiErrorBody,
  type ApiErrorCode,
  type AvailabilityWindow,
  type DepartmentSummary,
  type PermissionAction,
  type RbacResource,
  type RoleCode,
  type StaffHomeAreaResponse,
  type StaffListResponse,
  type StaffRecord,
  type StaffType,
  type StoreFormat,
  type StoreListResponse,
  type StoreWithDepartments,
  type WeeklyAvailability,
  type Weekday,
} from '@lanewise/shared'
import type { ApiResponse } from './client'
import { MOCK_DEPARTMENTS, MOCK_REGIONS, MOCK_STORES, mockStoreScope } from './mock-directory'
import { WORLD_STAFF, barangayByCode, departmentById, staffById, type WorldAvailability, type WorldStaff } from './mock-world'

/**
 * In-memory master data for the mock API: SCR-052 stores, departments and
 * lanes and SCR-053 staff and availability. Mirrors the API: the RBAC rows
 * "Stores / departments / lanes" (Rules Steward manages, Store Manager sees
 * their own store) and "Staff records" / "Staff availability" (HR manages,
 * Store Manager edits their own store's staff), lists filtered to the role's
 * demo scope, and a record outside scope answers the same 404 as a missing
 * one. Sample data — simulated, not SM actuals.
 */

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

interface MockStore {
  id: string
  code: string
  name: string
  format: StoreFormat
  regionId: string
  active: boolean
}

/** Weekly availability by the world's pattern kind (wireframe SCR-053 "Availability pattern"). */
const AVAILABILITY: Readonly<Record<WorldAvailability, WeeklyAvailability>> = {
  any: FULL_AVAILABILITY,
  student: {
    ...FULL_AVAILABILITY,
    mon: ['afternoon', 'evening'],
    tue: ['afternoon', 'evening'],
    wed: ['afternoon', 'evening'],
    thu: ['afternoon', 'evening'],
    fri: ['afternoon', 'evening'],
  },
  evenings: Object.fromEntries(WEEKDAYS.map((d) => [d, ['evening']])) as unknown as WeeklyAvailability,
  weekends: { ...Object.fromEntries(WEEKDAYS.map((d) => [d, []])), sat: [...AVAILABILITY_WINDOWS], sun: [...AVAILABILITY_WINDOWS] } as unknown as WeeklyAvailability,
  no_sundays: { ...FULL_AVAILABILITY, sun: [] },
}

const STAFF_TYPE: Readonly<Record<WorldStaff['contract'], StaffType>> = { FT: 'full_time', PT: 'part_time', FLOAT: 'float' }

const MISSING = 'This item doesn’t exist or you don’t have access to it.'

let requestSeq = 0
function fail(code: ApiErrorCode, message: string): ApiResponse {
  requestSeq += 1
  const body: ApiErrorBody = { error: { code, message, requestId: `mock-md-${requestSeq.toString(16).padStart(6, '0')}` } }
  return { status: HTTP_STATUS_BY_ERROR_CODE[code], body }
}

const ok = (body: unknown, status = 200): ApiResponse => ({ status, body })

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'
const trimmed = (v: unknown, max: number): string | null => {
  if (!isString(v)) return null
  const s = v.trim()
  return s.length > 0 && s.length <= max ? s : null
}
const isWeekday = (v: unknown): v is Weekday => isString(v) && (WEEKDAYS as readonly string[]).includes(v)
const isStaffType = (v: unknown): v is StaffType => isString(v) && (STAFF_TYPES as readonly string[]).includes(v)
const isFormat = (v: unknown): v is StoreFormat => isString(v) && (STORE_FORMATS as readonly string[]).includes(v)

export interface MasterDataRequest {
  readonly method: string
  readonly pathname: string
  readonly query: URLSearchParams
  readonly body: unknown
  readonly role: RoleCode
}

export function createMasterDataStore() {
  const stores: MockStore[] = MOCK_STORES.map((s) => ({ ...s, active: true }))
  const departments: Mutable<DepartmentSummary>[] = MOCK_DEPARTMENTS.map((d) => ({
    id: d.id,
    storeId: d.storeId,
    name: d.name,
    installedLanes: departmentById(d.id)?.installedLanes ?? 6,
    defaultHandleTimeMin: departmentById(d.id)?.handleTimeMin ?? 2,
    tradingHours: { open: '09:00', close: '22:00' },
    active: true,
    synthetic: true,
  }))
  const staff: Mutable<StaffRecord>[] = WORLD_STAFF.map((m) => ({
    id: m.id,
    employeeNo: m.employeeNo,
    name: m.name,
    type: STAFF_TYPE[m.contract],
    storeId: m.storeId,
    storeName: MOCK_STORES.find((s) => s.id === m.storeId)?.name ?? '',
    departmentId: m.departmentId,
    departmentName: MOCK_DEPARTMENTS.find((d) => d.id === m.departmentId)?.name ?? '',
    preferredRestDay: m.preferredRestDay,
    availability: AVAILABILITY[m.availability],
    unavailableDates: m.unavailable.map((u, i) => ({ id: `${m.id}-u${i + 1}`, date: u.date, reason: u.reason, source: 'manual' as const })),
    active: m.active,
    synthetic: true,
  }))
  let seq = 0
  const nextId = (prefix: string) => `${prefix}-new-${(seq += 1)}`

  // The demo scopes: Store Manager = the Quezon City store, Staff = no store-wide data, everyone else the network.
  const inScope = (role: RoleCode, storeId: string) =>
    role === 'STF' ? false : role === 'STM' ? mockStoreScope(role).includes(storeId) : true
  const allowed = (role: RoleCode, resource: RbacResource, action: PermissionAction) => can(role, resource, action)

  const storeView = (s: MockStore): StoreWithDepartments => ({
    ...s,
    regionName: MOCK_REGIONS.find((r) => r.id === s.regionId)?.name ?? '',
    synthetic: true,
    departments: departments.filter((d) => d.storeId === s.id).map((d) => ({ ...d })),
  })

  const staffView = (s: StaffRecord): StaffRecord => ({
    ...s,
    storeName: stores.find((x) => x.id === s.storeId)?.name ?? '',
    departmentName: departments.find((d) => d.id === s.departmentId)?.name ?? '',
    unavailableDates: [...s.unavailableDates].sort((a, b) => a.date.localeCompare(b.date)),
  })

  function listStores(role: RoleCode): ApiResponse {
    if (!allowed(role, 'master_data', 'view')) return fail('forbidden', 'You do not have access to this resource.')
    const visible = stores.filter((s) => inScope(role, s.id))
    const regionIds = new Set(visible.map((s) => s.regionId))
    const body: StoreListResponse = {
      stores: visible.map(storeView),
      regions: MOCK_REGIONS.filter((r) => role !== 'STM' || regionIds.has(r.id)).map((r) => ({ id: r.id, code: r.id, name: r.name })),
    }
    return ok(body)
  }

  function createStore(role: RoleCode, body: unknown): ApiResponse {
    if (!allowed(role, 'master_data', 'manage')) return fail('forbidden', 'You do not have access to this resource.')
    if (!isRecord(body)) return fail('validation_failed', 'Some fields are missing or invalid.')
    const code = trimmed(body.code, 40)
    const name = trimmed(body.name, 120)
    if (!code || !name || !isFormat(body.format) || !MOCK_REGIONS.some((r) => r.id === body.regionId)) {
      return fail('validation_failed', 'Some fields are missing or invalid.')
    }
    if (stores.some((s) => s.code === code)) return fail('conflict', 'That code or name is already in use.')
    const store: MockStore = { id: nextId('st'), code, name, format: body.format, regionId: String(body.regionId), active: true }
    stores.push(store)
    return ok(storeView(store), 201)
  }

  function updateStore(role: RoleCode, id: string, body: unknown): ApiResponse {
    if (!allowed(role, 'master_data', 'manage')) return fail('forbidden', 'You do not have access to this resource.')
    const store = stores.find((s) => s.id === id)
    if (!store || !inScope(role, id)) return fail('not_found', MISSING)
    if (!isRecord(body)) return fail('validation_failed', 'Some fields are missing or invalid.')
    const name = body.name === undefined ? store.name : trimmed(body.name, 120)
    if (!name || (body.format !== undefined && !isFormat(body.format)) || (body.active !== undefined && typeof body.active !== 'boolean')) {
      return fail('validation_failed', 'Some fields are missing or invalid.')
    }
    store.name = name
    if (isFormat(body.format)) store.format = body.format
    if (typeof body.active === 'boolean') store.active = body.active
    return ok(storeView(store))
  }

  function updateDepartment(role: RoleCode, id: string, body: unknown): ApiResponse {
    if (!allowed(role, 'master_data', 'manage')) return fail('forbidden', 'You do not have access to this resource.')
    const dept = departments.find((d) => d.id === id)
    if (!dept || !inScope(role, dept.storeId)) return fail('not_found', MISSING)
    if (!isRecord(body)) return fail('validation_failed', 'Some fields are missing or invalid.')
    const lanes = body.installedLanes
    const aht = body.defaultHandleTimeMin
    const hours = body.tradingHours
    const badLanes = lanes !== undefined && !(typeof lanes === 'number' && Number.isInteger(lanes) && lanes >= 0 && lanes <= 500)
    const badAht = aht !== undefined && !(typeof aht === 'number' && aht > 0 && aht <= 60)
    const badHours =
      hours !== undefined &&
      !(isRecord(hours) && isString(hours.open) && isString(hours.close) && CLOCK_TIME_PATTERN.test(hours.open) && CLOCK_TIME_PATTERN.test(hours.close) && hours.close > hours.open)
    const name = body.name === undefined ? dept.name : trimmed(body.name, 120)
    if (badLanes || badAht || badHours || !name) return fail('validation_failed', 'Some fields are missing or invalid.')
    dept.name = name
    if (typeof lanes === 'number') dept.installedLanes = lanes
    if (typeof aht === 'number') dept.defaultHandleTimeMin = aht
    if (isRecord(hours) && isString(hours.open) && isString(hours.close)) dept.tradingHours = { open: hours.open, close: hours.close }
    if (typeof body.active === 'boolean') dept.active = body.active
    return ok({ ...dept })
  }

  function listStaff(role: RoleCode, query: URLSearchParams): ApiResponse {
    if (!allowed(role, 'staff_records', 'view')) return fail('forbidden', 'You do not have access to this resource.')
    const type = query.get('type')
    if (type !== null && !isStaffType(type)) return fail('validation_failed', 'Some fields are missing or invalid.')
    const q = (query.get('q') ?? '').trim().toLowerCase()
    const storeId = query.get('storeId')
    const departmentId = query.get('departmentId')
    const body: StaffListResponse = {
      staff: staff
        .filter((s) => inScope(role, s.storeId))
        .filter((s) => storeId === null || s.storeId === storeId)
        .filter((s) => departmentId === null || s.departmentId === departmentId)
        .filter((s) => type === null || s.type === type)
        .filter((s) => q.length === 0 || s.name.toLowerCase().includes(q) || s.employeeNo.toLowerCase().includes(q))
        .map(staffView),
      truncated: false,
    }
    return ok(body)
  }

  /** The record when the role may `action` on `resource` and it is in scope; else the API's error. */
  function reach(role: RoleCode, id: string, resource: RbacResource, action: PermissionAction): Mutable<StaffRecord> | ApiResponse {
    if (!allowed(role, resource, action)) return fail('forbidden', 'You do not have access to this resource.')
    const record = staff.find((s) => s.id === id)
    return record && inScope(role, record.storeId) ? record : fail('not_found', MISSING)
  }
  const isResponse = (v: Mutable<StaffRecord> | ApiResponse): v is ApiResponse => 'status' in v

  function createStaff(role: RoleCode, body: unknown): ApiResponse {
    if (!allowed(role, 'staff_records', 'manage')) return fail('forbidden', 'You do not have access to this resource.')
    if (!isRecord(body)) return fail('validation_failed', 'Some fields are missing or invalid.')
    const storeId = String(body.storeId ?? '')
    if (!stores.some((s) => s.id === storeId) || !inScope(role, storeId)) return fail('not_found', MISSING)
    const employeeNo = trimmed(body.employeeNo, 40)
    const name = trimmed(body.name, 120)
    const dept = departments.find((d) => d.id === body.departmentId && d.storeId === storeId)
    const rest = body.preferredRestDay ?? null
    if (!employeeNo || !name || !dept || !isStaffType(body.type) || (rest !== null && !isWeekday(rest))) {
      return fail('validation_failed', 'Some fields are missing or invalid.')
    }
    if (staff.some((s) => s.storeId === storeId && s.employeeNo === employeeNo)) {
      return fail('conflict', 'That staff ID is already used in this store.')
    }
    const record: Mutable<StaffRecord> = {
      id: nextId('staff'),
      employeeNo,
      name,
      type: body.type,
      storeId,
      storeName: '',
      departmentId: dept.id,
      departmentName: '',
      preferredRestDay: rest,
      availability: FULL_AVAILABILITY,
      unavailableDates: [],
      active: true,
      synthetic: true,
    }
    staff.push(record)
    return ok(staffView(record), 201)
  }

  function updateStaff(role: RoleCode, id: string, body: unknown): ApiResponse {
    const record = reach(role, id, 'staff_records', 'edit')
    if (isResponse(record)) return record
    if (!isRecord(body)) return fail('validation_failed', 'Some fields are missing or invalid.')
    const name = body.name === undefined ? record.name : trimmed(body.name, 120)
    const dept = body.departmentId === undefined ? undefined : departments.find((d) => d.id === body.departmentId && d.storeId === record.storeId)
    const rest = body.preferredRestDay
    if (
      !name ||
      (body.type !== undefined && !isStaffType(body.type)) ||
      (body.departmentId !== undefined && !dept) ||
      (rest !== undefined && rest !== null && !isWeekday(rest)) ||
      (body.active !== undefined && typeof body.active !== 'boolean')
    ) {
      return fail('validation_failed', 'Some fields are missing or invalid.')
    }
    record.name = name
    if (isStaffType(body.type)) record.type = body.type
    if (dept) record.departmentId = dept.id
    if (rest === null || isWeekday(rest)) record.preferredRestDay = rest
    if (typeof body.active === 'boolean') record.active = body.active
    return ok(staffView(record))
  }

  function setAvailability(role: RoleCode, id: string, body: unknown): ApiResponse {
    const record = reach(role, id, 'staff_availability', 'edit')
    if (isResponse(record)) return record
    const raw = isRecord(body) ? body.availability : undefined
    if (!isRecord(raw)) return fail('validation_failed', 'Some fields are missing or invalid.')
    const next = {} as Record<Weekday, AvailabilityWindow[]>
    for (const day of WEEKDAYS) {
      const value = raw[day]
      if (!Array.isArray(value) || value.some((w) => !(AVAILABILITY_WINDOWS as readonly unknown[]).includes(w))) {
        return fail('validation_failed', 'Some fields are missing or invalid.')
      }
      next[day] = AVAILABILITY_WINDOWS.filter((w) => value.includes(w))
    }
    record.availability = next
    return ok(staffView(record))
  }

  function addUnavailable(role: RoleCode, id: string, body: unknown): ApiResponse {
    const record = reach(role, id, 'staff_availability', 'edit')
    if (isResponse(record)) return record
    const date = isRecord(body) ? body.date : undefined
    if (!isString(date) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      return fail('validation_failed', 'Use a date like 2026-12-14.')
    }
    if (record.unavailableDates.some((d) => d.date === date)) return fail('conflict', 'This date is already marked unavailable.')
    const reason = isRecord(body) && isString(body.reason) && body.reason.trim().length > 0 ? body.reason.trim() : null
    record.unavailableDates = [...record.unavailableDates, { id: nextId('una'), date, reason, source: 'manual' }]
    return ok(staffView(record), 201)
  }

  function removeUnavailable(role: RoleCode, id: string, entryId: string): ApiResponse {
    const record = reach(role, id, 'staff_availability', 'edit')
    if (isResponse(record)) return record
    const entry = record.unavailableDates.find((d) => d.id === entryId)
    if (!entry) return fail('not_found', MISSING)
    if (entry.source !== 'manual') return fail('conflict', 'Only dates added here can be removed.')
    record.unavailableDates = record.unavailableDates.filter((d) => d.id !== entryId)
    return ok(staffView(record))
  }

  function homeArea(role: RoleCode, id: string): ApiResponse {
    const record = reach(role, id, 'staff_home_area', 'view')
    if (isResponse(record)) return record
    const world = staffById(id)
    const area = world?.homeArea ? barangayByCode(world.homeArea) : undefined
    const body: StaffHomeAreaResponse =
      world && area
        ? { staffId: id, shared: true, barangay: { code: area.code, name: area.name, city: area.city }, maxTravelMin: world.maxTravelMin, crossStoreOffers: world.crossStoreOffers }
        : { staffId: id, shared: false }
    return ok(body)
  }

  return {
    /** Whether this store answers `pathname`. */
    owns: (pathname: string) => /^\/(stores|departments|staff)(\/|$)/.test(pathname),
    handle({ method, pathname, query, body, role }: MasterDataRequest): ApiResponse {
      const parts = pathname.split('/').slice(1).map(decodeURIComponent)
      const [root, id, sub, subId] = parts
      const route = `${method} /${root}${id !== undefined ? '/:id' : ''}${sub !== undefined ? `/${sub}` : ''}${subId !== undefined ? '/:sub' : ''}`
      switch (route) {
        case 'GET /stores':
          return listStores(role)
        case 'POST /stores':
          return createStore(role, body)
        case 'GET /stores/:id': {
          const store = stores.find((s) => s.id === id)
          if (!allowed(role, 'master_data', 'view')) return fail('forbidden', 'You do not have access to this resource.')
          return store && inScope(role, store.id) ? ok(storeView(store)) : fail('not_found', MISSING)
        }
        case 'PATCH /stores/:id':
          return updateStore(role, id ?? '', body)
        case 'PATCH /departments/:id':
          return updateDepartment(role, id ?? '', body)
        case 'GET /staff':
          return listStaff(role, query)
        case 'POST /staff':
          return createStaff(role, body)
        case 'GET /staff/:id': {
          const record = reach(role, id ?? '', 'staff_records', 'view')
          return isResponse(record) ? record : ok(staffView(record))
        }
        case 'PATCH /staff/:id':
          return updateStaff(role, id ?? '', body)
        case 'PUT /staff/:id/availability':
          return setAvailability(role, id ?? '', body)
        case 'POST /staff/:id/unavailable-dates':
          return addUnavailable(role, id ?? '', body)
        case 'DELETE /staff/:id/unavailable-dates/:sub':
          return removeUnavailable(role, id ?? '', subId ?? '')
        case 'GET /staff/:id/home-area':
          return homeArea(role, id ?? '')
        default:
          return fail('not_found', 'We couldn’t find that.')
      }
    },
  }
}
