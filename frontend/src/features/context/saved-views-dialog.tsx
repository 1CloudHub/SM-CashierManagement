import { SAVED_VIEW_NAME_MAX, type SavedView } from '@lanewise/shared'
import { useId, useState, type FormEvent } from 'react'
import { ApiError } from '@/api'
import { AppLink, useRouter } from '@/app/router'
import { useAnnouncer } from '@/components/a11y'
import { Cluster, Stack } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Pill } from '@/components/ui/pill'
import { useI18n } from '@/i18n'
import type { useSavedViews } from './use-context-data'

/**
 * The "Saved views" dialog (wireframes/_build.py `ctx()`; requirement 21.5):
 * the user's own views for this screen (open, rename, make default, delete)
 * and "Save current filters as". Views are private to the user — the API
 * only ever returns and changes the caller's own (task 20) — and each change
 * is audited server-side (P7).
 */
export function SavedViewsDialog({
  query,
  views,
}: {
  /** The current canonical view query. */
  query: string
  /** The screen's saved views (the hook owns the screen). */
  views: ReturnType<typeof useSavedViews>
}) {
  const { t } = useI18n()
  const { location } = useRouter()
  const { announce } = useAnnouncer()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [makeDefault, setMakeDefault] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const defaultId = useId()
  const listId = useId()

  const errorText = (err: unknown) =>
    err instanceof ApiError && err.code === 'conflict' ? t('savedViews.error.duplicate') : t('savedViews.error.generic')

  const onSave = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('savedViews.error.name'))
      return
    }
    setBusy(true)
    try {
      const view = await views.create({ name: trimmed, query, isDefault: makeDefault })
      announce(t('savedViews.saved', { name: view.name }))
      setName('')
      setMakeDefault(false)
      setError(null)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setError(null)
      }}
    >
      <DialogTrigger asChild>
        <Button>{t('savedViews.open')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('savedViews.title')}</DialogTitle>
          <DialogDescription>{t('savedViews.urlNote')}</DialogDescription>
        </DialogHeader>

        <section aria-labelledby={listId}>
          <h3 id={listId} className="sr-only">
            {t('savedViews.listLabel')}
          </h3>
          {views.error ? (
            <p role="alert" className="text-body text-danger">
              {t('savedViews.loadError')}{' '}
              <Button size="sm" onClick={views.reload}>
                {t('action.retry')}
              </Button>
            </p>
          ) : views.loading ? (
            <p className="text-body text-text-muted">{t('state.loading')}</p>
          ) : (views.data ?? []).length === 0 ? (
            <p className="text-body text-text-muted">{t('savedViews.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {(views.data ?? []).map((view) => (
                <SavedViewRow
                  key={view.id}
                  view={view}
                  href={`${location.pathname}${view.query ? `?${view.query}` : ''}`}
                  views={views}
                  onOpen={() => setOpen(false)}
                  errorText={errorText}
                />
              ))}
            </ul>
          )}
        </section>

        <form onSubmit={onSave} noValidate>
          <Stack gap={3}>
            <Field label={t('savedViews.nameLabel')} error={error ?? undefined} required>
              {(aria) => (
                <Input
                  {...aria}
                  value={name}
                  maxLength={SAVED_VIEW_NAME_MAX}
                  onChange={(e) => {
                    setName(e.target.value)
                    if (error) setError(null)
                  }}
                />
              )}
            </Field>
            <Cluster gap={2} as="label" htmlFor={defaultId} className="min-h-tap text-body text-text">
              <input
                id={defaultId}
                type="checkbox"
                className="size-5 accent-primary"
                checked={makeDefault}
                onChange={(e) => setMakeDefault(e.target.checked)}
              />
              {t('savedViews.defaultLabel')}
            </Cluster>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button">{t('action.cancel')}</Button>
              </DialogClose>
              <Button type="submit" variant="primary" disabled={busy}>
                {t('savedViews.save')}
              </Button>
            </DialogFooter>
          </Stack>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SavedViewRow({
  view,
  href,
  views,
  onOpen,
  errorText,
}: {
  view: SavedView
  href: string
  views: ReturnType<typeof useSavedViews>
  onOpen: () => void
  errorText: (err: unknown) => string
}) {
  const { t } = useI18n()
  const { announce } = useAnnouncer()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(view.name)
  const [error, setError] = useState<string | null>(null)

  const run = async (action: () => Promise<SavedView>, message: string) => {
    try {
      const result = await action()
      announce(t(message, { name: result.name }))
      setError(null)
      return true
    } catch (err) {
      setError(errorText(err))
      return false
    }
  }

  const onRename = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('savedViews.error.name'))
      return
    }
    if (await run(() => views.update(view.id, { name: trimmed }), 'savedViews.updated')) setRenaming(false)
  }

  return (
    <li className="flex flex-col gap-2 border-2 border-outline p-3">
      <Cluster gap={2}>
        <AppLink href={href} onClick={onOpen} className="text-body text-text underline focus-visible:outline-focus-ring">
          {view.name}
        </AppLink>
        {view.isDefault && <Pill>{t('savedViews.isDefault')}</Pill>}
      </Cluster>
      {renaming ? (
        <form onSubmit={onRename} noValidate>
          <Cluster gap={2} align="end">
            <Field label={t('savedViews.renameLabel', { name: view.name })} error={error ?? undefined}>
              {(aria) => <Input {...aria} value={name} maxLength={SAVED_VIEW_NAME_MAX} onChange={(e) => setName(e.target.value)} />}
            </Field>
            <Button type="submit" size="sm" variant="primary">
              {t('savedViews.renameSave')}
            </Button>
            <Button type="button" size="sm" onClick={() => setRenaming(false)}>
              {t('action.cancel')}
            </Button>
          </Cluster>
        </form>
      ) : (
        <Cluster gap={2}>
          <Button size="sm" aria-label={t('savedViews.renameAria', { name: view.name })} onClick={() => setRenaming(true)}>
            {t('savedViews.rename')}
          </Button>
          <Button
            size="sm"
            aria-label={t(view.isDefault ? 'savedViews.unsetDefaultLabel' : 'savedViews.makeDefaultLabel', { name: view.name })}
            onClick={() => void run(() => views.update(view.id, { isDefault: !view.isDefault }), 'savedViews.updated')}
          >
            {t(view.isDefault ? 'savedViews.unsetDefault' : 'savedViews.makeDefault')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('savedViews.deleteLabel', { name: view.name })}
            onClick={() => void run(() => views.remove(view.id), 'savedViews.deleted')}
          >
            {t('savedViews.delete')}
          </Button>
        </Cluster>
      )}
      {error && !renaming && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
    </li>
  )
}
