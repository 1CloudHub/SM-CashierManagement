/**
 * Geometry for the network map (task 16.1): the schematic projection, the
 * travel-time ring radius, and city anchors for the staff layer.
 *
 * Privacy (P15): staff are drawn per CITY (the 17 Metro Manila LGUs) — coarser
 * than the barangay the API returns — at the city hall's public position. No
 * person-linked coordinate exists anywhere in the SPA; only store sites are
 * positioned exactly, and they are business premises.
 */
import type { MapTravelMode, MapStaffArea } from '@lanewise/shared'

/** Metro Manila bounds for the schematic map (degrees). */
export const METRO_BOUNDS = { south: 14.38, north: 14.78, west: 120.92, east: 121.13 } as const

/** Mid-latitude correction so the schematic is not stretched east–west. */
const LON_SCALE = Math.cos((14.58 * Math.PI) / 180)

/** Width ÷ height of the schematic viewport. */
export const SCHEMATIC_ASPECT = ((METRO_BOUNDS.east - METRO_BOUNDS.west) * LON_SCALE) / (METRO_BOUNDS.north - METRO_BOUNDS.south)

/** Position as fractions (0–1) of the schematic viewport, x left→right, y top→bottom. */
export function project(lat: number, lon: number): { x: number; y: number } {
  const x = (lon - METRO_BOUNDS.west) / (METRO_BOUNDS.east - METRO_BOUNDS.west)
  const y = (METRO_BOUNDS.north - lat) / (METRO_BOUNDS.north - METRO_BOUNDS.south)
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }
}

/** Kilometres per degree of latitude. */
const KM_PER_DEG = 111.32

/** Same estimate as the API's straight-line fallback: 20 km/h by car, ×1.3 detour, ×1.5 public transport. */
export function ringRadiusKm(minutes: number, mode: MapTravelMode): number {
  const carKm = ((minutes / 60) * 20) / 1.3
  return mode === 'car' ? carKm : carKm / 1.5
}

/** A ring radius as a fraction of the schematic viewport HEIGHT. */
export function ringRadiusFraction(minutes: number, mode: MapTravelMode): number {
  return ringRadiusKm(minutes, mode) / KM_PER_DEG / (METRO_BOUNDS.north - METRO_BOUNDS.south)
}

/** A circle polygon (GeoJSON ring, lon/lat) of `km` around a point — for the MapLibre map. */
export function circlePolygon(lat: number, lon: number, km: number, steps = 64): [number, number][] {
  const dLat = km / KM_PER_DEG
  const dLon = km / (KM_PER_DEG * Math.cos((lat * Math.PI) / 180))
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = (i / steps) * 2 * Math.PI
    return [lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)] as [number, number]
  })
}

/** Public city-hall positions of the Metro Manila LGUs (approximate). */
export const CITY_ANCHORS: Readonly<Record<string, { lat: number; lon: number }>> = {
  Caloocan: { lat: 14.6507, lon: 120.9673 },
  'Las Piñas': { lat: 14.4497, lon: 120.9831 },
  Makati: { lat: 14.5547, lon: 121.0244 },
  Malabon: { lat: 14.6627, lon: 120.9568 },
  Mandaluyong: { lat: 14.5794, lon: 121.0359 },
  Manila: { lat: 14.5896, lon: 120.9811 },
  Marikina: { lat: 14.6507, lon: 121.1029 },
  Muntinlupa: { lat: 14.4081, lon: 121.0415 },
  Navotas: { lat: 14.6667, lon: 120.9417 },
  Parañaque: { lat: 14.4793, lon: 121.0198 },
  Pasay: { lat: 14.5378, lon: 121.0014 },
  Pasig: { lat: 14.5764, lon: 121.0851 },
  Pateros: { lat: 14.5446, lon: 121.0687 },
  'Quezon City': { lat: 14.676, lon: 121.0437 },
  'San Juan': { lat: 14.6019, lon: 121.0355 },
  Taguig: { lat: 14.5176, lon: 121.0509 },
  Valenzuela: { lat: 14.7011, lon: 120.983 },
}

export interface CityStaffCount {
  readonly city: string
  readonly count: number
  readonly anchor: { readonly lat: number; readonly lon: number } | null
}

/** Rolls barangay counts up to their city (coarser still) for drawing. */
export function staffByCity(layer: readonly MapStaffArea[]): CityStaffCount[] {
  const totals = new Map<string, number>()
  for (const a of layer) totals.set(a.barangay.city, (totals.get(a.barangay.city) ?? 0) + a.count)
  return [...totals]
    .map(([city, count]) => ({ city, count, anchor: CITY_ANCHORS[city] ?? null }))
    .sort((a, b) => (a.city < b.city ? -1 : a.city > b.city ? 1 : 0))
}
