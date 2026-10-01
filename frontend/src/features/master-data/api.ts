/**
 * Master data API client: SCR-052 `/stores`, `/departments` and SCR-053
 * `/staff`.
 *
 * Screens depend on the `MasterDataClient` interface so they can be rendered
 * with a fake in tests; the app wires `createMasterDataClient` over the shared
 * API client (`useApi`, task 8.2), which sends the active role.
 */
import type {
  AddUnavailableDateRequest,
  CreateStaffRequest,
  CreateStoreRequest,
  DepartmentSummary,
  StaffListQuery,
  StaffListResponse,
  StaffRecord,
  StoreListResponse,
  StoreWithDepartments,
  UpdateDepartmentRequest,
  UpdateStaffRequest,
  UpdateStoreRequest,
  WeeklyAvailability,
} from '@lanewise/shared'
import type { ApiClient, HttpMethod } from '@/api'

export interface MasterDataClient {
  listStores(): Promise<StoreListResponse>
  createStore(input: CreateStoreRequest): Promise<StoreWithDepartments>
  updateStore(storeId: string, input: UpdateStoreRequest): Promise<StoreWithDepartments>
  updateDepartment(departmentId: string, input: UpdateDepartmentRequest): Promise<DepartmentSummary>
  listStaff(query?: StaffListQuery): Promise<StaffListResponse>
  createStaff(input: CreateStaffRequest): Promise<StaffRecord>
  updateStaff(staffId: string, input: UpdateStaffRequest): Promise<StaffRecord>
  setAvailability(staffId: string, availability: WeeklyAvailability): Promise<StaffRecord>
  addUnavailableDate(staffId: string, input: AddUnavailableDateRequest): Promise<StaffRecord>
  removeUnavailableDate(staffId: string, entryId: string): Promise<StaffRecord>
}

/** `?storeId=…&type=…` for the set filters only. */
export function staffQueryString(query: StaffListQuery = {}): string {
  const params = new URLSearchParams()
  if (query.storeId) params.set('storeId', query.storeId)
  if (query.departmentId) params.set('departmentId', query.departmentId)
  if (query.type) params.set('type', query.type)
  if (query.q && query.q.trim().length > 0) params.set('q', query.q.trim())
  const s = params.toString()
  return s.length > 0 ? `?${s}` : ''
}

export function createMasterDataClient(api: Pick<ApiClient, 'request'>): MasterDataClient {
  const request = <T,>(method: HttpMethod, path: string, body?: unknown): Promise<T> =>
    api.request<T>(method, path, body !== undefined ? { body } : {})
  const id = encodeURIComponent
  return {
    listStores: () => request('GET', '/stores'),
    createStore: (input) => request('POST', '/stores', input),
    updateStore: (storeId, input) => request('PATCH', `/stores/${id(storeId)}`, input),
    updateDepartment: (departmentId, input) => request('PATCH', `/departments/${id(departmentId)}`, input),
    listStaff: (query) => request('GET', `/staff${staffQueryString(query)}`),
    createStaff: (input) => request('POST', '/staff', input),
    updateStaff: (staffId, input) => request('PATCH', `/staff/${id(staffId)}`, input),
    setAvailability: (staffId, availability) => request('PUT', `/staff/${id(staffId)}/availability`, { availability }),
    addUnavailableDate: (staffId, input) => request('POST', `/staff/${id(staffId)}/unavailable-dates`, input),
    removeUnavailableDate: (staffId, entryId) =>
      request('DELETE', `/staff/${id(staffId)}/unavailable-dates/${id(entryId)}`),
  }
}
