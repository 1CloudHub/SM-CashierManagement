import type { BarangayStaffCount } from '@lanewise/shared'
import { Section } from '@/components/layout'
import {
  Num,
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

/**
 * SCR-026 › "Available cashiers (home area)" layer as its equivalent data
 * table (requirement 11.8, 12.4). Planners get counts per barangay only —
 * the input is the API's aggregation, which never lists people and leaves
 * out anyone who hasn't consented.
 */
export function BarangayCountTable({ counts }: { counts: readonly BarangayStaffCount[] }) {
  const { t } = useI18n()
  return (
    <Section title={t('homeAreaCounts.title')} titleAs="h3" description={t('homeAreaCounts.note')}>
      <TableWrap>
        <Table aria-label={t('homeAreaCounts.tableLabel')}>
          <TableHead>
            <TableRow>
              <TableHeaderCell>{t('homeAreaCounts.col.barangay')}</TableHeaderCell>
              <TableHeaderCell>{t('homeAreaCounts.col.city')}</TableHeaderCell>
              <TableHeaderCell className="text-right">{t('homeAreaCounts.col.count')}</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {counts.length === 0 && <TableEmpty colSpan={3}>{t('homeAreaCounts.empty')}</TableEmpty>}
            {counts.map((c) => (
              <TableRow key={c.barangay.code}>
                <TableRowHeader>{c.barangay.name}</TableRowHeader>
                <TableCell>{c.barangay.city}</TableCell>
                <TableCell className="text-right">
                  <Num value={c.count} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableWrap>
    </Section>
  )
}
