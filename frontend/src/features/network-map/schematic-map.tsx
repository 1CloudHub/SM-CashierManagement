import type { MapStorePin, MapTravelMode } from '@lanewise/shared'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import { project, ringRadiusFraction, SCHEMATIC_ASPECT, type CityStaffCount } from './geo'
import { deltaText, STATUS_PRESENTATION, statusLabel } from './format'

export interface MapLayers {
  readonly stores: boolean
  readonly staff: boolean
  readonly rings: boolean
}

export interface MapViewProps {
  readonly stores: readonly MapStorePin[]
  readonly staff: readonly CityStaffCount[]
  readonly layers: MapLayers
  readonly rings: readonly number[]
  readonly mode: MapTravelMode
  readonly selectedId: string | null
  readonly onSelect: (storeId: string) => void
}

const VIEW_H = 100
const VIEW_W = SCHEMATIC_ASPECT * VIEW_H

/**
 * The non-network map (task 16.1): a schematic of Metro Manila drawn from
 * store sites, used in mock mode, in tests and whenever Amazon Location is
 * not configured. Pins are real buttons (keyboard and screen reader), each
 * named with its status in words; rings and city markers are drawn for
 * sighted users and repeated in the legend and the tables.
 */
export function SchematicMap({ stores, staff, layers, rings, mode, selectedId, onSelect }: MapViewProps) {
  const { t } = useI18n()
  const selected = stores.find((s) => s.storeId === selectedId && s.site)
  const centre = selected?.site ? project(selected.site.lat, selected.site.lon) : null
  return (
    <div
      className="relative w-full overflow-hidden border border-outline bg-surface-2"
      style={{ aspectRatio: String(SCHEMATIC_ASPECT) }}
      data-testid="schematic-map"
    >
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="absolute inset-0 size-full" aria-hidden="true" focusable="false">
        {layers.rings && centre &&
          [...rings].reverse().map((minutes) => (
            <g key={minutes}>
              <circle
                cx={centre.x * VIEW_W}
                cy={centre.y * VIEW_H}
                r={ringRadiusFraction(minutes, mode) * VIEW_H}
                className="fill-primary-soft stroke-primary"
                fillOpacity={0.25}
                strokeWidth={0.4}
                strokeDasharray="1.2 0.8"
              />
              <text
                x={centre.x * VIEW_W}
                y={centre.y * VIEW_H - ringRadiusFraction(minutes, mode) * VIEW_H + 2.6}
                textAnchor="middle"
                className="fill-text"
                fontSize={2.4}
              >
                {t('map.ring.label', { minutes })}
              </text>
            </g>
          ))}
      </svg>
      {layers.staff &&
        staff.map((c) => {
          if (!c.anchor) return null
          const p = project(c.anchor.lat, c.anchor.lon)
          return (
            <span
              key={c.city}
              role="img"
              aria-label={t('map.staff.label', { city: c.city, count: c.count })}
              className="absolute -translate-x-1/2 -translate-y-1/2 border border-outline bg-surface px-1 text-caption text-text"
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
            >
              <span aria-hidden="true">◆ {c.count}</span>
            </span>
          )
        })}
      {layers.stores &&
        stores.map((s) => {
          if (!s.site) return null
          const p = project(s.site.lat, s.site.lon)
          const look = STATUS_PRESENTATION[s.status]
          const isSelected = s.storeId === selectedId
          return (
            <button
              key={s.storeId}
              type="button"
              aria-pressed={isSelected}
              aria-label={t('map.pin.label', { name: s.name, status: statusLabel(t, s), needed: s.required, rostered: s.rostered })}
              onClick={() => onSelect(s.storeId)}
              className={cn(
                'absolute flex min-h-6 min-w-6 -translate-x-1/2 -translate-y-1/2 items-center gap-1 whitespace-nowrap border px-1 text-caption motion-interactive focus-visible:outline-focus-ring',
                look.pin,
                isSelected && 'z-10 border-text font-weight-semibold',
              )}
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
            >
              <span aria-hidden="true">
                {look.glyph} {deltaText(s)} {s.name.replace(/^SM (City |Center )?/, '')}
              </span>
            </button>
          )
        })}
    </div>
  )
}
