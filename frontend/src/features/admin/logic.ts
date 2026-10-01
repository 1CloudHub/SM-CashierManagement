/**
 * Pure helpers for the admin screens (SCR-070..073): paths, status tones and
 * the SCR-071 form rules (the same allowlist check the API enforces, P13).
 */
import {
  checkInviteEmail,
  sortRoles,
  type AdminScopeInput,
  type AdminScopeType,
  type AdminScopeView,
  type AdminUser,
  type RoleCode,
  type UserStatus,
} from '@lanewise/shared'
import type { StatusTone } from '@/components/ui'

export const USERS_PATH = '/admin/users'
export const INVITE_PATH = '/admin/users/invite'
export const ROLES_PATH = '/admin/roles'
export const AUDIT_PATH = '/admin/audit'

export function userEditPath(userId: string): string {
  return `${USERS_PATH}/${encodeURIComponent(userId)}`
}

export const USER_STATUS_TONE: Readonly<Record<UserStatus, StatusTone>> = {
  active: 'success',
  invited: 'info',
  disabled: 'neutral',
}

/** The SCR-071 form. */
export interface UserForm {
  readonly email: string
  readonly name: string
  readonly roles: readonly RoleCode[]
  readonly scopeType: AdminScopeType
  readonly regionIds: readonly string[]
  readonly storeIds: readonly string[]
}

export const EMPTY_FORM: UserForm = { email: '', name: '', roles: [], scopeType: 'global', regionIds: [], storeIds: [] }

export function formFromUser(user: AdminUser): UserForm {
  const scope = user.scope
  return {
    email: user.email,
    name: user.name,
    roles: user.roles,
    scopeType: scope.type === 'region' || scope.type === 'store' ? scope.type : 'global',
    regionIds: scope.type === 'region' ? scope.regions.map((r) => r.id) : [],
    storeIds: scope.type === 'store' ? scope.stores.map((s) => s.id) : [],
  }
}

/** Whether the data scope applies: any role other than Staff (which is always self-scoped). */
export function needsScope(roles: readonly RoleCode[]): boolean {
  return roles.some((r) => r !== 'STF')
}

export function scopeInput(form: UserForm): AdminScopeInput {
  switch (form.scopeType) {
    case 'global':
      return { type: 'global' }
    case 'region':
      return { type: 'region', regionIds: form.regionIds }
    case 'store':
      return { type: 'store', storeIds: form.storeIds }
  }
}

/** Message keys per field; empty when the form can be sent. */
export interface FormErrors {
  email?: string
  roles?: string
  scope?: string
}

export function validateUserForm(form: UserForm, mode: 'invite' | 'edit'): FormErrors {
  const errors: FormErrors = {}
  if (mode === 'invite') {
    const checked = checkInviteEmail(form.email)
    if (!checked.ok) errors.email = checked.problem === 'required' ? 'admin.form.error.emailRequired' : 'admin.form.error.domain'
  }
  if (form.roles.length === 0) errors.roles = 'admin.form.error.roles'
  if (needsScope(form.roles)) {
    if (form.scopeType === 'region' && form.regionIds.length === 0) errors.scope = 'admin.form.error.region'
    if (form.scopeType === 'store' && form.storeIds.length === 0) errors.scope = 'admin.form.error.store'
  }
  return errors
}

export function toggle<T>(list: readonly T[], value: T, on: boolean): T[] {
  return on ? [...new Set([...list, value])] : list.filter((v) => v !== value)
}

export function toggleRole(roles: readonly RoleCode[], role: RoleCode, on: boolean): RoleCode[] {
  return sortRoles(toggle(roles, role, on))
}

/** Names in a scope view (regions or stores), or `null` for global / self / none. */
export function scopeNames(scope: AdminScopeView): string[] | null {
  switch (scope.type) {
    case 'region':
      return scope.regions.map((r) => r.name)
    case 'store':
      return scope.stores.map((s) => s.name)
    case 'self':
      return scope.staff ? [scope.staff.name] : null
    default:
      return null
  }
}

/** Whether the SCR-073 From/To dates form a range (either may be empty). */
export function isDateRangeValid(from: string, to: string): boolean {
  return from === '' || to === '' || from <= to
}
