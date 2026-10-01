import { useId } from 'react'
import { Check, Minus } from 'lucide-react'
import { AVAILABILITY_WINDOWS, WEEKDAYS, type AvailabilityWindow, type WeeklyAvailability, type Weekday } from '@lanewise/shared'
import { Stack } from '@/components/layout'
import { Button, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TableRowHeader, TableWrap } from '@/components/ui'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { toggleWindow } from './logic'

export interface AvailabilityEditorProps {
  readonly value: WeeklyAvailability
  /** Omit for a read-only view. */
  readonly onChange?: (next: WeeklyAvailability) => void
  /** "grid" (day × time window toggles) or "table" (the accessible table alternative). */
  readonly view: 'grid' | 'table'
  readonly onViewChange: (view: 'grid' | 'table') => void
}

/**
 * SCR-053 weekly availability: a day × time-window grid of toggle buttons
 * (each states "Available" / "Not available" in text and icon, never colour
 * alone), and "View as table" — the same data as a captioned data table with
 * a checkbox per cell when editable.
 */
export function AvailabilityEditor({ value, onChange, view, onViewChange }: AvailabilityEditorProps) {
  const { t } = useI18n()
  const headingId = useId()
  const editable = onChange !== undefined
  const cellName = (day: Weekday, w: AvailabilityWindow) =>
    t('masterData.availability.cell', { day: t(`masterData.dayLong.${day}`), window: t(`masterData.window.${w}`) })

  return (
    <Stack gap={3}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={headingId} className="text-h3 text-text">
          {t('masterData.availability.title')}
        </h3>
        <Button size="sm" aria-pressed={view === 'table'} onClick={() => onViewChange(view === 'grid' ? 'table' : 'grid')}>
          {view === 'grid' ? t('masterData.availability.viewTable') : t('masterData.availability.viewGrid')}
        </Button>
      </div>
      <p className="text-body-sm text-text-muted">{t('masterData.availability.windowsHint')}</p>

      {view === 'grid' ? (
        <div role="group" aria-labelledby={headingId} className="grid grid-cols-[auto_repeat(3,minmax(0,1fr))] gap-1">
          <span aria-hidden="true" />
          {AVAILABILITY_WINDOWS.map((w) => (
            <span key={w} aria-hidden="true" className="px-1 text-label text-text-muted">
              {t(`masterData.window.${w}`)}
            </span>
          ))}
          {WEEKDAYS.map((day) => (
            <DayRow key={day} day={day} value={value} onChange={onChange} cellName={cellName} />
          ))}
        </div>
      ) : (
        <TableWrap>
          <Table>
            <caption className="sr-only">{t('masterData.availability.title')}</caption>
            <TableHead>
              <TableRow>
                <TableHeaderCell>{t('masterData.availability.day')}</TableHeaderCell>
                {AVAILABILITY_WINDOWS.map((w) => (
                  <TableHeaderCell key={w}>{t(`masterData.window.${w}`)}</TableHeaderCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {WEEKDAYS.map((day) => (
                <TableRow key={day}>
                  <TableRowHeader>{t(`masterData.dayLong.${day}`)}</TableRowHeader>
                  {AVAILABILITY_WINDOWS.map((w) => {
                    const on = value[day].includes(w)
                    return (
                      <TableCell key={w}>
                        {editable ? (
                          <label className="inline-flex min-h-tap items-center gap-2">
                            <input
                              type="checkbox"
                              className="size-5 accent-primary"
                              checked={on}
                              onChange={() => onChange(toggleWindow(value, day, w))}
                            />
                            <span>{on ? t('masterData.availability.available') : t('masterData.availability.unavailable')}</span>
                            <span className="sr-only">{cellName(day, w)}</span>
                          </label>
                        ) : on ? (
                          t('masterData.availability.available')
                        ) : (
                          t('masterData.availability.unavailable')
                        )}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      )}
    </Stack>
  )
}

function DayRow({
  day,
  value,
  onChange,
  cellName,
}: {
  day: Weekday
  value: WeeklyAvailability
  onChange: ((next: WeeklyAvailability) => void) | undefined
  cellName: (day: Weekday, w: AvailabilityWindow) => string
}) {
  const { t } = useI18n()
  return (
    <>
      <span className="self-center pr-2 text-label text-text" aria-hidden="true">
        {t(`masterData.day.${day}`)}
      </span>
      {AVAILABILITY_WINDOWS.map((w) => {
        const on = value[day].includes(w)
        const Icon = on ? Check : Minus
        const content = (
          <>
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            <span>{on ? t('masterData.availability.available') : t('masterData.availability.off')}</span>
          </>
        )
        const look = cn(
          'flex min-h-tap items-center justify-center gap-1 border border-outline px-1 text-body-sm',
          on ? 'bg-success-soft text-on-success-soft' : 'bg-surface text-text-muted',
        )
        return onChange ? (
          <button
            key={w}
            type="button"
            aria-pressed={on}
            aria-label={t('masterData.availability.cellState', {
              cell: cellName(day, w),
              state: on ? t('masterData.availability.available') : t('masterData.availability.off'),
            })}
            className={cn(look, 'motion-interactive focus-visible:outline-focus-ring')}
            onClick={() => onChange(toggleWindow(value, day, w))}
          >
            {content}
          </button>
        ) : (
          <span key={w} className={look}>
            <span className="sr-only">{cellName(day, w)}, </span>
            {content}
          </span>
        )
      })}
    </>
  )
}
