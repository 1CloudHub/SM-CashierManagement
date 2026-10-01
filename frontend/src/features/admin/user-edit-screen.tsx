import { useEffect, useId, useRef, useState } from 'react'
import {
  ADMIN_SCOPE_TYPES,
  ALLOWED_EMAIL_DOMAINS,
  ROLE_CODES,
  can,
  type AdminScopeType,
  type AdminUser,
  type RoleCode,
  type ScopeOptions,
} from '@lanewise/shared'
import { ApiError } from '@/api'
import { AppLink } from '@/app/router'
import { Cluster, Stack } from '@/components/layout'
import { Alert, Button, CardSkeleton, Field, Input, StateBlock, StatusPill, buttonVariants } from '@/components/ui'
import { useDocumentTitle } from '@/features/auth/use-document-title'
import { errorReference } from '@/features/scenarios/api'
import { useI18n } from '@/i18n'
import type { AdminClient } from './api'
import {
  EMPTY_FORM,
  USERS_PATH,
  USER_STATUS_TONE,
  formFromUser,
  needsScope,
  scopeInput,
  toggle,
  toggleRole,
  validateUserForm,
  type FormErrors,
  type UserForm,
} from './logic'

export interface UserEditScreenProps {
  readonly client: AdminClient
  readonly role: RoleCode | null
  /** `null` invites a new user (`/admin/users/invite`). */
  readonly userId: string | null
  readonly onDone: (user: AdminUser, mode: 'invite' | 'edit') => void
}

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly notFound: boolean; readonly referenceId?: string }
  | { readonly kind: 'ready'; readonly options: ScopeOptions; readonly user: AdminUser | null }

/** Maps an API validation error onto the form fields (P13: the server re-checks the allowlist). */
function serverErrors(error: unknown): FormErrors | null {
  if (!(error instanceof ApiError) || error.code !== 'validation_failed') return null
  const out: FormErrors = {}
  for (const d of error.details) {
    if (d.path.startsWith('body.email')) out.email = 'admin.form.error.domain'
    else if (d.path.startsWith('body.roles')) out.roles = d.message.includes('staff') ? 'admin.form.error.staff' : 'admin.form.error.roles'
    else if (d.path.startsWith('body.scope')) out.scope = 'admin.form.error.scopeInvalid'
  }
  return out
}

/**
 * SCR-071 Invite / edit user. Work email (allowlisted domains only, checked
 * here and again by the API), role checkboxes and the data scope: Global,
 * Region(s) or Store(s), whose selector appears for the chosen kind. Staff is
 * always scoped to the cashier's own record, linked by work email.
 */
export function UserEditScreen({ client, role, userId, onDone }: UserEditScreenProps) {
  const { t } = useI18n()
  const mode = userId === null ? 'invite' : 'edit'
  useDocumentTitle(t(mode === 'invite' ? 'admin.form.inviteTitle' : 'admin.form.editTitle'))
  const allowed = can(role, 'users_roles', 'manage')
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [form, setForm] = useState<UserForm>(EMPTY_FORM)
  const [errors, setErrors] = useState<FormErrors>({})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<{ text: string; referenceId?: string } | null>(null)
  const ids = { roles: useId(), scope: useId(), rolesError: useId(), scopeError: useId() }
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!allowed) return
    let live = true
    Promise.all([client.scopeOptions(), userId === null ? Promise.resolve(null) : client.getUser(userId)]).then(
      ([options, user]) => {
        if (!live) return
        setLoad({ kind: 'ready', options, user })
        if (user) setForm(formFromUser(user))
      },
      (error: unknown) =>
        live && setLoad({ kind: 'error', notFound: error instanceof ApiError && error.code === 'not_found', referenceId: errorReference(error) }),
    )
    return () => {
      live = false
    }
  }, [allowed, client, userId])

  if (!allowed) return <StateBlock variant="no-access" title={t('admin.noAccess.title')} description={t('admin.users.noAccess')} />
  const heading = (name?: string) => (
    <h1 className="text-h1 text-text">{mode === 'invite' ? t('admin.form.inviteTitle') : t('admin.form.editHeading', { name: name ?? '' })}</h1>
  )
  if (load.kind === 'loading') {
    return (
      <Stack gap={6}>
        {heading()}
        <CardSkeleton label={t('state.loading')} />
      </Stack>
    )
  }
  if (load.kind === 'error') {
    return load.notFound ? (
      <StateBlock variant="no-access" title={t('admin.form.notFound.title')} description={t('admin.form.notFound.description')} />
    ) : (
      <Stack gap={6}>
        {heading()}
        <StateBlock variant="error" title={t('admin.form.loadError')} referenceId={load.referenceId} />
      </Stack>
    )
  }

  const { options, user } = load
  const set = (patch: Partial<UserForm>) => setForm((f) => ({ ...f, ...patch }))
  const scoped = needsScope(form.roles)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const found = validateUserForm(form, mode)
    setErrors(found)
    setFailure(null)
    if (Object.keys(found).length > 0) {
      if (found.email) emailRef.current?.focus()
      else document.getElementById(found.roles ? ids.roles : ids.scope)?.focus()
      return
    }
    setBusy(true)
    try {
      const scope = scoped ? scopeInput(form) : undefined
      const name = form.name.trim()
      const saved =
        mode === 'invite'
          ? await client.invite({ email: form.email, ...(name ? { name } : {}), roles: form.roles, ...(scope ? { scope } : {}) })
          : await client.update(userId ?? '', { ...(name ? { name } : {}), roles: form.roles, ...(scope ? { scope } : {}) })
      onDone(saved, mode)
    } catch (error) {
      const fields = serverErrors(error)
      if (fields && Object.keys(fields).length > 0) setErrors(fields)
      else {
        const conflict = error instanceof ApiError && error.code === 'conflict'
        setFailure({ text: conflict ? error.message : t('admin.form.saveError'), referenceId: errorReference(error) })
      }
    } finally {
      setBusy(false)
    }
  }

  const domains = ALLOWED_EMAIL_DOMAINS.map((d) => `@${d}`).join(` ${t('admin.or')} `)
  const optionList = (kind: 'region' | 'store') => (kind === 'region' ? options.regions : options.stores)

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <Stack gap={6}>
        <Cluster gap={3} align="center">
          {heading(user?.name)}
          {user && <StatusPill tone={USER_STATUS_TONE[user.status]}>{t(`admin.status.${user.status}`)}</StatusPill>}
        </Cluster>

        {failure && (
          <Alert tone="danger" referenceId={failure.referenceId} assertive>
            {failure.text}
          </Alert>
        )}

        <Stack gap={4} className="max-w-xl">
          {mode === 'invite' ? (
            <Field
              label={t('admin.form.email')}
              hint={t('admin.form.emailHint', { domains })}
              error={errors.email ? t(errors.email) : undefined}
              required
            >
              {(aria) => (
                <Input
                  {...aria}
                  ref={emailRef}
                  type="email"
                  autoComplete="off"
                  value={form.email}
                  onChange={(e) => set({ email: e.target.value })}
                />
              )}
            </Field>
          ) : (
            <Stack gap={1}>
              <span className="text-label text-text">{t('admin.form.email')}</span>
              <span className="text-body text-text">{user?.email}</span>
            </Stack>
          )}
          <Field label={t('admin.form.name')} hint={t('admin.form.nameHint')}>
            {(aria) => <Input {...aria} autoComplete="off" value={form.name} onChange={(e) => set({ name: e.target.value })} />}
          </Field>
        </Stack>

        <fieldset
          className="flex flex-col gap-2"
          aria-describedby={errors.roles ? ids.rolesError : undefined}
          aria-invalid={errors.roles ? true : undefined}
        >
          <legend className="text-label text-text">
            {t('admin.form.roles')}
            <span className="text-danger">
              {' '}
              *<span className="sr-only"> {t('admin.form.required')}</span>
            </span>
          </legend>
          {errors.roles && (
            <p id={ids.rolesError} className="text-body-sm text-danger" role="alert">
              {t(errors.roles)}
            </p>
          )}
          <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            {ROLE_CODES.map((r, i) => (
              <label key={r} className="flex min-h-tap items-center gap-2 text-body text-text">
                <input
                  id={i === 0 ? ids.roles : undefined}
                  type="checkbox"
                  className="size-5 accent-primary"
                  checked={form.roles.includes(r)}
                  onChange={(e) => set({ roles: toggleRole(form.roles, r, e.target.checked) })}
                />
                {t(`role.${r}`)}
              </label>
            ))}
          </div>
          {form.roles.includes('STF') && <p className="text-body-sm text-text-muted">{t('admin.form.staffHint')}</p>}
        </fieldset>

        <fieldset
          className="flex flex-col gap-2"
          disabled={!scoped}
          aria-describedby={errors.scope ? ids.scopeError : undefined}
          aria-invalid={errors.scope ? true : undefined}
        >
          <legend className="text-label text-text">{t('admin.form.scope')}</legend>
          {!scoped && <p className="text-body-sm text-text-muted">{t('admin.form.scopeNotNeeded')}</p>}
          {errors.scope && (
            <p id={ids.scopeError} className="text-body-sm text-danger" role="alert">
              {t(errors.scope)}
            </p>
          )}
          <Cluster gap={4}>
            {ADMIN_SCOPE_TYPES.map((kind, i) => {
              const unavailable = kind !== 'global' && optionList(kind).length === 0
              return (
                <label key={kind} className="flex min-h-tap items-center gap-2 text-body text-text">
                  <input
                    id={i === 0 ? ids.scope : undefined}
                    type="radio"
                    name="admin-scope"
                    className="size-5 accent-primary"
                    value={kind}
                    disabled={unavailable}
                    checked={form.scopeType === kind}
                    onChange={() => set({ scopeType: kind as AdminScopeType })}
                  />
                  {t(`admin.form.scope.${kind}`)}
                </label>
              )
            })}
          </Cluster>
          {scoped && form.scopeType !== 'global' && (
            <fieldset className="flex flex-col gap-1 border border-outline p-3">
              <legend className="px-1 text-label text-text">{t(`admin.form.choose.${form.scopeType}`)}</legend>
              <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                {optionList(form.scopeType).map((opt) => {
                  const key = form.scopeType === 'region' ? 'regionIds' : 'storeIds'
                  const selected = form[key]
                  return (
                    <label key={opt.id} className="flex min-h-tap items-center gap-2 text-body text-text">
                      <input
                        type="checkbox"
                        className="size-5 accent-primary"
                        checked={selected.includes(opt.id)}
                        onChange={(e) => set({ [key]: toggle(selected, opt.id, e.target.checked) })}
                      />
                      {opt.name}
                    </label>
                  )
                })}
              </div>
            </fieldset>
          )}
        </fieldset>

        <Cluster gap={3}>
          <AppLink href={USERS_PATH} className={buttonVariants({ variant: 'secondary' })}>
            {t('action.cancel')}
          </AppLink>
          <Button type="submit" variant="primary" loading={busy} loadingLabel={t('admin.working')}>
            {mode === 'invite' ? t('admin.form.send') : t('admin.form.save')}
          </Button>
        </Cluster>
      </Stack>
    </form>
  )
}
