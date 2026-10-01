import {
  PERMISSION_ACTIONS,
  PERMISSION_LETTERS,
  RBAC_RESOURCES,
  ROLE_CODES,
  can,
  permissionFor,
  permissionLetters,
  type RoleCode,
} from '@lanewise/shared'
import { Stack } from '@/components/layout'
import { StateBlock, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableRowHeader, TableWrap } from '@/components/ui'
import { useDocumentTitle } from '@/features/auth/use-document-title'
import { useI18n } from '@/i18n'

export interface RolesScreenProps {
  readonly role: RoleCode | null
}

/**
 * SCR-072 Roles and permissions: the read-only RBAC matrix, rendered from the
 * shared matrix data the API enforces (`RBAC_MATRIX`), so the page cannot
 * drift from what the server allows. Cells are letters (V/E/A/X/M) with a
 * text legend — never colour — and each role has a short description.
 */
export function RolesScreen({ role }: RolesScreenProps) {
  const { t } = useI18n()
  useDocumentTitle(t('admin.roles.title'))
  if (!can(role, 'users_roles', 'view')) {
    return <StateBlock variant="no-access" title={t('admin.noAccess.title')} description={t('admin.users.noAccess')} />
  }

  return (
    <Stack gap={6}>
      <Stack gap={2}>
        <h1 className="text-h1 text-text">{t('admin.roles.title')}</h1>
        <p className="text-body text-text-muted">{t('admin.roles.intro')}</p>
      </Stack>

      <section aria-labelledby="roles-legend">
        <h2 id="roles-legend" className="text-h3 text-text">
          {t('admin.roles.legend')}
        </h2>
        <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-body text-text">
          {PERMISSION_ACTIONS.map((a) => (
            <div key={a} className="flex gap-2">
              <dt className="lw-numeric font-weight-semibold">{PERMISSION_LETTERS[a]}</dt>
              <dd>{t(`admin.roles.action.${a}`)}</dd>
            </div>
          ))}
          <div className="flex gap-2">
            <dt className="lw-numeric font-weight-semibold">—</dt>
            <dd>{t('admin.roles.noAccessCell')}</dd>
          </div>
        </dl>
      </section>

      <TableWrap>
        <Table>
          <caption className="sr-only">{t('admin.roles.caption')}</caption>
          <TableHead>
            <TableRow>
              <TableHeaderCell>{t('admin.roles.capability')}</TableHeaderCell>
              {ROLE_CODES.map((r) => (
                <TableHeaderCell key={r}>
                  <abbr title={t(`role.${r}`)} className="no-underline">
                    {r}
                  </abbr>
                  <span className="sr-only"> {t(`role.${r}`)}</span>
                </TableHeaderCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {RBAC_RESOURCES.map((resource) => (
              <TableRow key={resource}>
                <TableRowHeader>{t(`rbac.resource.${resource}`)}</TableRowHeader>
                {ROLE_CODES.map((r) => {
                  const permission = permissionFor(r, resource)
                  const letters = permissionLetters(permission)
                  return (
                    <TableCell key={r} className="lw-numeric">
                      {letters === null ? (
                        <>
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">{t('admin.roles.noAccessCell')}</span>
                        </>
                      ) : (
                        <>
                          <span aria-hidden="true">{letters}</span>
                          <span className="sr-only">{permission?.actions.map((a) => t(`admin.roles.action.${a}`)).join(', ')}</span>
                          {permission?.limit && <span className="block text-body-sm text-text-muted">{t(`rbac.limit.${permission.limit}`)}</span>}
                        </>
                      )}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableWrap>

      <section aria-labelledby="roles-descriptions">
        <h2 id="roles-descriptions" className="text-h3 text-text">
          {t('admin.roles.descriptions')}
        </h2>
        <dl className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
          {ROLE_CODES.map((r) => (
            <div key={r} className="border border-outline p-3">
              <dt className="text-label text-text">
                {t(`role.${r}`)} <span className="text-text-muted">({r})</span>
              </dt>
              <dd className="text-body text-text-muted">{t(`admin.roles.describe.${r}`)}</dd>
            </div>
          ))}
        </dl>
      </section>
    </Stack>
  )
}
