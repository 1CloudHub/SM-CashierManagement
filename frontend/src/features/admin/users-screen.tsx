import { useCallback, useDeferredValue, useEffect, useState } from 'react'
import {
  ADMIN_USER_STATUS_FILTERS,
  ROLE_CODES,
  can,
  type AdminUser,
  type AdminUserStatusFilter,
  type RoleCode,
} from '@lanewise/shared'
import { AppLink } from '@/app/router'
import { Cluster, Stack } from '@/components/layout'
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
import { useDocumentTitle } from '@/features/auth/use-document-title'
import { DATE_TIME } from '@/features/scenarios/logic'
import { errorReference } from '@/features/scenarios/api'
import { useI18n } from '@/i18n'
import type { AdminClient } from './api'
import { INVITE_PATH, USER_STATUS_TONE, scopeNames, userEditPath } from './logic'

export interface UsersScreenProps {
  readonly client: AdminClient
  readonly role: RoleCode | null
  /** A one-off notice after SCR-071 (e.g. "Invitation sent to …"). */
  readonly notice?: string | null
}

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly referenceId?: string }
  | { readonly kind: 'ready'; readonly users: readonly AdminUser[]; readonly demoMode: boolean }

type Notice = { readonly tone: 'success' | 'danger'; readonly text: string; readonly referenceId?: string } | null

/**
 * SCR-070 Users (RBAC "Users and roles": System Admin manages). Lists the
 * users inside the administrator's scope (the API filters, P1) with role and
 * status filters, and links to SCR-071 to invite or edit. Deactivation asks
 * for confirmation first; a pending invitation can be re-sent.
 */
export function UsersScreen({ client, role, notice: initialNotice = null }: UsersScreenProps) {
  const { t, formatDateTime } = useI18n()
  useDocumentTitle(t('admin.users.title'))
  const [roleFilter, setRoleFilter] = useState<RoleCode | ''>('')
  const [status, setStatus] = useState<AdminUserStatusFilter>('all')
  const [search, setSearch] = useState('')
  const q = useDeferredValue(search)
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [notice, setNotice] = useState<Notice>(initialNotice ? { tone: 'success', text: initialNotice } : null)
  const [confirm, setConfirm] = useState<AdminUser | null>(null)
  const [busy, setBusy] = useState(false)
  const allowed = can(role, 'users_roles', 'view')

  const fetchUsers = useCallback(() => {
    return client.listUsers({ ...(roleFilter ? { role: roleFilter } : {}), status, q }).then(
      (res) => setLoad({ kind: 'ready', users: res.users, demoMode: res.demoMode }),
      (error: unknown) => setLoad({ kind: 'error', referenceId: errorReference(error) }),
    )
  }, [client, roleFilter, status, q])

  useEffect(() => {
    if (allowed) void fetchUsers()
  }, [allowed, fetchUsers])

  if (!allowed) {
    return <StateBlock variant="no-access" title={t('admin.noAccess.title')} description={t('admin.users.noAccess')} />
  }

  const replace = (updated: AdminUser) =>
    setLoad((l) => (l.kind === 'ready' ? { ...l, users: l.users.map((u) => (u.id === updated.id ? updated : u)) } : l))

  async function act(user: AdminUser, kind: 'deactivate' | 'resend') {
    setBusy(true)
    try {
      const updated = kind === 'deactivate' ? await client.deactivate(user.id) : await client.resend(user.id)
      replace(updated)
      setNotice({ tone: 'success', text: t(kind === 'deactivate' ? 'admin.users.deactivated' : 'admin.users.resent', { name: user.name, email: user.email }) })
    } catch (error) {
      setNotice({ tone: 'danger', text: t('admin.users.actionFailed'), referenceId: errorReference(error) })
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  return (
    <Stack gap={6}>
      <Cluster gap={4} justify="between" align="center">
        <h1 className="text-h1 text-text">{t('admin.users.title')}</h1>
        <AppLink href={INVITE_PATH} className={buttonVariants({ variant: 'primary' })}>
          {t('admin.users.invite')}
        </AppLink>
      </Cluster>

      {load.kind === 'ready' && load.demoMode && (
        <Alert tone="info" live={false}>
          {t('admin.users.demoBanner')}
        </Alert>
      )}
      {notice && (
        <Alert tone={notice.tone} referenceId={notice.referenceId}>
          {notice.text}
        </Alert>
      )}

      <Cluster gap={4} align="end">
        <Field label={t('admin.users.search')}>
          {(aria) => <Input {...aria} type="search" value={search} onChange={(e) => setSearch(e.target.value)} />}
        </Field>
        <Field label={t('admin.users.role')}>
          {(aria) => (
            <Select {...aria} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as RoleCode | '')}>
              <option value="">{t('admin.filter.all')}</option>
              {ROLE_CODES.map((r) => (
                <option key={r} value={r}>
                  {t(`role.${r}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('admin.users.status')}>
          {(aria) => (
            <Select {...aria} value={status} onChange={(e) => setStatus(e.target.value as AdminUserStatusFilter)}>
              {ADMIN_USER_STATUS_FILTERS.map((s) => (
                <option key={s} value={s}>
                  {t(s === 'all' ? 'admin.filter.all' : `admin.status.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </Cluster>

      {load.kind === 'loading' && <TableSkeleton rows={4} columns={7} label={t('state.loading')} />}
      {load.kind === 'error' && (
        <StateBlock
          variant="error"
          title={t('admin.users.error')}
          referenceId={load.referenceId}
          action={<Button onClick={() => void fetchUsers()}>{t('action.retry')}</Button>}
        />
      )}
      {load.kind === 'ready' && load.users.length === 0 && (
        <StateBlock variant="empty" title={t('admin.users.empty.title')} description={t('admin.users.empty.description')} />
      )}
      {load.kind === 'ready' && load.users.length > 0 && (
        <TableWrap>
          <Table>
            <caption className="sr-only">{t('admin.users.caption')}</caption>
            <TableHead>
              <TableRow>
                <TableHeaderCell>{t('admin.users.col.name')}</TableHeaderCell>
                <TableHeaderCell>{t('admin.users.col.email')}</TableHeaderCell>
                <TableHeaderCell>{t('admin.users.col.roles')}</TableHeaderCell>
                <TableHeaderCell>{t('admin.users.col.scope')}</TableHeaderCell>
                <TableHeaderCell>{t('admin.users.col.lastSignIn')}</TableHeaderCell>
                <TableHeaderCell>{t('admin.users.col.status')}</TableHeaderCell>
                <TableHeaderCell>{t('admin.users.col.actions')}</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {load.users.map((user) => (
                <TableRow key={user.id}>
                  <TableRowHeader>{user.name}</TableRowHeader>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{user.roles.length > 0 ? user.roles.map((r) => t(`role.${r}`)).join(', ') : t('admin.none')}</TableCell>
                  <TableCell>{scopeNames(user.scope)?.join(', ') ?? t(`admin.scope.${user.scope.type}`)}</TableCell>
                  <TableCell>{user.lastSignIn ? formatDateTime(user.lastSignIn, DATE_TIME) : t('admin.none')}</TableCell>
                  <TableCell>
                    <StatusPill tone={USER_STATUS_TONE[user.status]}>{t(`admin.status.${user.status}`)}</StatusPill>
                  </TableCell>
                  <TableCell>
                    <Cluster gap={2}>
                      <AppLink
                        href={userEditPath(user.id)}
                        className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                        aria-label={t('admin.users.editNamed', { name: user.name })}
                      >
                        {t('action.edit')}
                      </AppLink>
                      {user.status === 'invited' && (
                        <Button size="sm" disabled={busy} onClick={() => void act(user, 'resend')} aria-label={t('admin.users.resendNamed', { name: user.name })}>
                          {t('admin.users.resend')}
                        </Button>
                      )}
                      {user.status !== 'disabled' && (
                        <Button size="sm" disabled={busy} onClick={() => setConfirm(user)} aria-label={t('admin.users.deactivateNamed', { name: user.name })}>
                          {t('admin.users.deactivate')}
                        </Button>
                      )}
                    </Cluster>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      )}

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && !busy && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.users.confirm.title', { name: confirm?.name ?? '' })}</DialogTitle>
            <DialogDescription>{t('admin.users.confirm.body')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirm(null)} disabled={busy}>
              {t('action.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={busy}
              loadingLabel={t('admin.working')}
              onClick={() => confirm && void act(confirm, 'deactivate')}
            >
              {t('admin.users.deactivate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Stack>
  )
}
