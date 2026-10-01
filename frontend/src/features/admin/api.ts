/**
 * Admin API client (SCR-070..073): `/admin/users`, `/admin/scope-options`
 * and `/audit-events`.
 *
 * Screens depend on the `AdminClient` interface so they can be rendered with
 * a fake in tests; the app wires `createAdminClient` over the shared API
 * client (`useApi`), which sends the active role on every request.
 */
import type {
  AdminUser,
  AdminUserListResponse,
  AdminUserStatusFilter,
  AuditLogQuery,
  AuditLogResponse,
  FileDownload,
  InviteUserRequest,
  RoleCode,
  ScopeOptions,
  UpdateUserRequest,
} from '@lanewise/shared'
import type { ApiClient, HttpMethod } from '@/api'

export interface UserListQuery {
  readonly role?: RoleCode
  readonly status?: AdminUserStatusFilter
  readonly q?: string
}

export interface AdminClient {
  listUsers(query?: UserListQuery): Promise<AdminUserListResponse>
  getUser(userId: string): Promise<AdminUser>
  scopeOptions(): Promise<ScopeOptions>
  invite(body: InviteUserRequest): Promise<AdminUser>
  update(userId: string, body: UpdateUserRequest): Promise<AdminUser>
  deactivate(userId: string): Promise<AdminUser>
  resend(userId: string): Promise<AdminUser>
  auditLog(query?: AuditLogQuery): Promise<AuditLogResponse>
  exportAuditLog(query?: AuditLogQuery): Promise<FileDownload>
}

/** `?a=1&b=2` from the defined, non-empty values (or `''`). */
export function queryString(values: Readonly<Record<string, string | undefined>>): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(values)) if (v !== undefined && v !== '') params.set(k, v)
  const s = params.toString()
  return s ? `?${s}` : ''
}

export function auditQueryString(q: AuditLogQuery = {}): string {
  return queryString({ from: q.from, to: q.to, userId: q.userId, category: q.category, object: q.object })
}

export function createAdminClient(api: Pick<ApiClient, 'request'>): AdminClient {
  const request = <T,>(method: HttpMethod, path: string, body?: unknown): Promise<T> =>
    api.request<T>(method, path, body !== undefined ? { body } : {})
  const id = encodeURIComponent
  const user = async (method: HttpMethod, path: string, body?: unknown) => (await request<{ user: AdminUser }>(method, path, body)).user
  return {
    listUsers: (q = {}) =>
      request('GET', `/admin/users${queryString({ role: q.role, status: q.status === 'all' ? undefined : q.status, q: q.q?.trim() })}`),
    getUser: (userId) => user('GET', `/admin/users/${id(userId)}`),
    scopeOptions: () => request('GET', '/admin/scope-options'),
    invite: (body) => user('POST', '/admin/users', body),
    update: (userId, body) => user('PATCH', `/admin/users/${id(userId)}`, body),
    deactivate: (userId) => user('POST', `/admin/users/${id(userId)}/deactivate`),
    resend: (userId) => user('POST', `/admin/users/${id(userId)}/resend`),
    auditLog: (q) => request('GET', `/audit-events${auditQueryString(q)}`),
    exportAuditLog: (q) => request('GET', `/audit-events/export${auditQueryString(q)}`),
  }
}
