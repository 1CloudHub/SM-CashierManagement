import type { MapStorePin, StaffingStatus } from '@lanewise/shared'
import type { StatusTone } from '@/components/ui'

/** `13.5` → `13:30`. */
export function clock(hour: number): string {
  const h = Math.floor(hour)
  const m = Math.round((hour - h) * 60)
  return `${String(h % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Status tone + shape glyph: status is always text + shape + colour, never colour alone. */
export const STATUS_PRESENTATION: Readonly<Record<StaffingStatus, { tone: StatusTone; glyph: string; pin: string }>> = {
  gap: { tone: 'danger', glyph: '▼', pin: 'bg-danger-soft text-on-danger-soft border-danger' },
  surplus: { tone: 'info', glyph: '▲', pin: 'bg-info-soft text-on-info-soft border-info' },
  balanced: { tone: 'success', glyph: '●', pin: 'bg-success-soft text-on-success-soft border-success' },
}

/** "−4", "+3" or "✓" on a pin. */
export function deltaText(pin: Pick<MapStorePin, 'status' | 'delta'>): string {
  if (pin.status === 'balanced') return '✓'
  return pin.delta > 0 ? `+${pin.delta}` : `−${Math.abs(pin.delta)}`
}

/** Status label key + count for a pin (e.g. "Short 4"). */
export function statusLabel(t: (id: string, v?: Record<string, string | number>) => string, pin: Pick<MapStorePin, 'status' | 'delta'>): string {
  return t(`map.status.${pin.status}`, { count: Math.abs(pin.delta) })
}

/** Today's date in Metro Manila (UTC+8) as YYYY-MM-DD. */
export function manilaToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10)
}
