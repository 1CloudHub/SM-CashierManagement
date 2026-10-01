/**
 * Users and roles, audit log (SCR-070..073): the screens and the
 * `/admin/users`, `/admin/scope-options` and `/audit-events` API client. The
 * app router mounts the screens through `./pages`.
 */
export { createAdminClient, type AdminClient, type UserListQuery } from './api'
export { AuditScreen, type AuditScreenProps } from './audit-screen'
export { RolesScreen, type RolesScreenProps } from './roles-screen'
export { UserEditScreen, type UserEditScreenProps } from './user-edit-screen'
export { UsersScreen, type UsersScreenProps } from './users-screen'
export { AuditPage, RolesPage, UserEditPage, UsersPage } from './pages'
