import type { MapStorePin } from '@lanewise/shared'
import { Section } from '@/components/layout'
import {
  Button,
  Num,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableRowHeader,
  TableWrap,
} from '@/components/ui'
import { useI18n } from '@/i18n'
import { STATUS_PRESENTATION, statusLabel } from './format'

/**
 * The map's stores as an equivalent data table (requirement 11.8): every pin
 * with its status in words (icon + label + colour), counts, and the same
 * "Find cover" action as clicking the pin. Short stores first.
 */
export function StoresTable({
  stores,
  selectedId,
  onSelect,
}: {
  stores: readonly MapStorePin[]
  selectedId: string | null
  onSelect: (storeId: string) => void
}) {
  const { t } = useI18n()
  const rows = [...stores].sort((a, b) => a.delta - b.delta || a.name.localeCompare(b.name))
  return (
    <Section title={t('map.stores.title')} titleAs="h2">
      <TableWrap>
        <Table aria-label={t('map.stores.tableLabel')}>
          <TableHead>
            <TableRow>
              <TableHeaderCell>{t('map.stores.col.store')}</TableHeaderCell>
              <TableHeaderCell>{t('map.stores.col.format')}</TableHeaderCell>
              <TableHeaderCell>{t('map.stores.col.status')}</TableHeaderCell>
              <TableHeaderCell className="text-right">{t('map.stores.col.needed')}</TableHeaderCell>
              <TableHeaderCell className="text-right">{t('map.stores.col.rostered')}</TableHeaderCell>
              <TableHeaderCell className="text-right">{t('map.stores.col.open')}</TableHeaderCell>
              <TableHeaderCell>{t('map.stores.col.action')}</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 && <TableEmpty colSpan={7}>{t('map.empty.description')}</TableEmpty>}
            {rows.map((s) => {
              const selected = s.storeId === selectedId
              return (
                <TableRow key={s.storeId}>
                  <TableRowHeader>{s.name}</TableRowHeader>
                  <TableCell>{t(`map.format.${s.format}`)}</TableCell>
                  <TableCell>
                    <StatusPill tone={STATUS_PRESENTATION[s.status].tone}>{statusLabel(t, s)}</StatusPill>
                  </TableCell>
                  <TableCell className="text-right">
                    <Num value={s.required} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Num value={s.rostered} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Num value={s.openShifts} />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant={selected ? 'secondary' : 'ghost'}
                      aria-pressed={selected}
                      aria-label={t('map.stores.selectStore', { name: s.name })}
                      onClick={() => onSelect(s.storeId)}
                    >
                      {selected ? t('map.stores.selected') : t('map.stores.select')}
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableWrap>
    </Section>
  )
}
