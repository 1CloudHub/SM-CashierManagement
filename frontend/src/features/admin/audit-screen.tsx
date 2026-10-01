import { useCallback, useDeferredValue, useEffect, useState } from 'react'
import { auditChanges, can, type AuditEventCategory, type AuditLogQuery, type AuditLogResponse, type RoleCode } from '@lanewise/shared'
import { Cluster, Stack } from '@/components/layout'
import {
  Alert,
  Button,
  Field,
  Input,
  Select,
  StateBlock,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableRowHeader,
  TableSkeleton,
  TableWrap,
} from '@/components/ui'
import { useDocumentTitle } from '@/features/auth/use-document-title'
import { downloadFile } from '@/features/data/api'
import { DATE_TIME } from '@/features/scenarios/logic'
import { errorReference } from '@/features/scenarios/api'
import { useI18n } from '@/i18n'
import type { AdminClient } from './api'
import { isDateRangeValid } from './logic'

export interface AuditScreenProps {
  readonly client: Pick<AdminClient, 'auditLog' | 'exportAuditLog'>
  readonly role: RoleCode | null
  /** Saves the exported file (a Blob download in the browser; a spy in tests). */
  readonly save?: typeof downloadFile
}

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly referenceId?: string }
  | { readonly kind: 'ready'; readonly data: AuditLogResponse }

type Notice = { readonly tone: 'success' | 'danger'; readonly text: string; readonly referenceId?: string } | null

/**
 * SCR-073 Audit log (RBAC "Audit log": System Admin views and exports; Rules
 * Steward views data and rules events only — the API narrows every query).
 * From/To, user, event type and object filters; Export CSV records its own
 * audit event on the server.
 */
export function AuditScreen({ client, role, save = downloadFile }: AuditScreenProps) {
  const { t, formatDateTime } = useI18n()
  useDocumentTitle(t('admin.audit.title'))
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [userId, setUserId] = useState('')
  const [category, setCategory] = useState<AuditEventCategory | ''>('')
  const [objectText, setObjectText] = useState('')
  const object = useDeferredValue(objectText)
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [notice, setNotice] = useState<Notice>(null)
  const [exporting, setExporting] = useState(false)
  const allowed = can(role, 'audit_log', 'view')
  const canExport = can(role, 'audit_log', 'export')
  const rangeOk = isDateRangeValid(from, to)

  const query: AuditLogQuery = {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(userId ? { userId } : {}),
    ...(category ? { category } : {}),
    ...(object.trim() ? { object: object.trim() } : {}),
  }
  const key = JSON.stringify(query)

  const fetchLog = useCallback(() => {
    const q = JSON.parse(key) as AuditLogQuery
    return client.auditLog(q).then(
      (data) => setLoad({ kind: 'ready', data }),
      (error: unknown) => setLoad({ kind: 'error', referenceId: errorReference(error) }),
    )
  }, [client, key])

  useEffect(() => {
    if (allowed && rangeOk) void fetchLog()
  }, [allowed, rangeOk, fetchLog])

  if (!allowed) {
    return <StateBlock variant="no-access" title={t('admin.noAccess.title')} description={t('admin.audit.noAccess')} />
  }

  async function exportCsv() {
    setExporting(true)
    setNotice(null)
    try {
      save(await client.exportAuditLog(query))
      setNotice({ tone: 'success', text: t('admin.audit.exported') })
    } catch (error) {
      setNotice({ tone: 'danger', text: t('admin.audit.exportError'), referenceId: errorReference(error) })
    } finally {
      setExporting(false)
    }
  }

  const data = load.kind === 'ready' ? load.data : null
  const limited = data !== null && !data.categories.includes('user')

  return (
    <Stack gap={6}>
      <Cluster gap={4} justify="between" align="center">
        <h1 className="text-h1 text-text">{t('admin.audit.title')}</h1>
        {canExport && (
          <Button onClick={() => void exportCsv()} loading={exporting} loadingLabel={t('admin.working')} disabled={!rangeOk}>
            {t('admin.audit.export')}
          </Button>
        )}
      </Cluster>
      {limited && (
        <Alert tone="info" live={false}>
          {t('admin.audit.stewardNote')}
        </Alert>
      )}
      {notice && (
        <Alert tone={notice.tone} referenceId={notice.referenceId}>
          {notice.text}
        </Alert>
      )}

      <Cluster gap={4} align="start">
        <Field label={t('admin.audit.from')}>
          {(aria) => <Input {...aria} type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />}
        </Field>
        <Field label={t('admin.audit.to')} error={rangeOk ? undefined : t('admin.audit.rangeError')}>
          {(aria) => <Input {...aria} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />}
        </Field>
        <Field label={t('admin.audit.user')}>
          {(aria) => (
            <Select {...aria} value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">{t('admin.audit.anyone')}</option>
              {data?.actors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('admin.audit.eventType')}>
          {(aria) => (
            <Select {...aria} value={category} onChange={(e) => setCategory(e.target.value as AuditEventCategory | '')}>
              <option value="">{t('admin.filter.all')}</option>
              {data?.categories.map((c) => (
                <option key={c} value={c}>
                  {t(`admin.audit.category.${c}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('admin.audit.object')}>
          {(aria) => <Input {...aria} type="search" value={objectText} onChange={(e) => setObjectText(e.target.value)} />}
        </Field>
      </Cluster>

      {load.kind === 'loading' && <TableSkeleton rows={5} columns={5} label={t('state.loading')} />}
      {load.kind === 'error' && (
        <StateBlock
          variant="error"
          title={t('admin.audit.error')}
          referenceId={load.referenceId}
          action={<Button onClick={() => void fetchLog()}>{t('action.retry')}</Button>}
        />
      )}
      {data && data.events.length === 0 && (
        <StateBlock variant="empty" title={t('admin.audit.empty.title')} description={t('admin.audit.empty.description')} />
      )}
      {data && data.events.length > 0 && (
        <>
          {data.truncated && (
            <Alert tone="info" live={false}>
              {t('admin.audit.truncated', { count: data.events.length })}
            </Alert>
          )}
          <TableWrap>
            <Table>
              <caption className="sr-only">{t('admin.audit.caption')}</caption>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>{t('admin.audit.col.time')}</TableHeaderCell>
                  <TableHeaderCell>{t('admin.audit.col.user')}</TableHeaderCell>
                  <TableHeaderCell>{t('admin.audit.col.event')}</TableHeaderCell>
                  <TableHeaderCell>{t('admin.audit.col.object')}</TableHeaderCell>
                  <TableHeaderCell>{t('admin.audit.col.detail')}</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.events.map((e) => {
                  const changes = auditChanges(e.before, e.after)
                  return (
                    <TableRow key={e.id}>
                      <TableRowHeader>{formatDateTime(e.at, DATE_TIME)}</TableRowHeader>
                      <TableCell>
                        {e.user.name}
                        <span className="block text-body-sm text-text-muted">{t('admin.audit.as', { role: t(`role.${e.activeRole}`) })}</span>
                      </TableCell>
                      <TableCell>
                        <code className="text-body-sm">{e.event}</code>
                      </TableCell>
                      <TableCell>
                        {e.objectName ?? e.objectId}
                        <span className="block text-body-sm text-text-muted">{e.objectType}</span>
                      </TableCell>
                      <TableCell>
                        {changes.length === 0 ? (
                          t('admin.none')
                        ) : (
                          <ul className="flex flex-col gap-1 text-body-sm">
                            {changes.slice(0, 4).map((c) => (
                              <li key={c.field}>
                                {c.field}: {c.before ?? t('admin.none')} → {c.after ?? t('admin.none')}
                              </li>
                            ))}
                            {changes.length > 4 && <li className="text-text-muted">{t('admin.audit.more', { count: changes.length - 4 })}</li>}
                          </ul>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableWrap>
        </>
      )}
    </Stack>
  )
}
