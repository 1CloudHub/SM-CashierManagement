/**
 * The network map on Amazon Location Service tiles via MapLibre GL (task
 * 16.1). Loaded lazily, and only when the runtime config carries a map name
 * and browser key — never in mock mode or tests, which use the schematic map.
 *
 * The canvas is a visual aid: it is hidden from assistive technology, and the
 * same stores, statuses, counts and the "Find cover" action are in the data
 * tables next to it (requirement 11.8). Colours come from the design tokens
 * at runtime; every pin also carries its status as a shape and text label.
 */
import { useEffect, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import { circlePolygon, ringRadiusKm } from './geo'
import { deltaText, STATUS_PRESENTATION } from './format'
import { mapStyleUrl, type MapRuntimeConfig } from './map-config'
import type { MapViewProps } from './schematic-map'

const CENTRE: [number, number] = [121.03, 14.58]

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || 'currentColor'
}

function storesGeoJson(props: MapViewProps): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: props.stores
      .filter((s) => s.site)
      .map((s) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.site!.lon, s.site!.lat] },
        properties: { id: s.storeId, status: s.status, label: `${STATUS_PRESENTATION[s.status].glyph} ${deltaText(s)} ${s.name}`, selected: s.storeId === props.selectedId },
      })),
  }
}

function staffGeoJson(props: MapViewProps): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: props.staff
      .filter((c) => c.anchor)
      .map((c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.anchor!.lon, c.anchor!.lat] }, properties: { label: `◆ ${c.count}` } })),
  }
}

function ringsGeoJson(props: MapViewProps): FeatureCollection {
  const s = props.stores.find((x) => x.storeId === props.selectedId && x.site)
  if (!s?.site) return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: [...props.rings].reverse().map((minutes) => ({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [circlePolygon(s.site!.lat, s.site!.lon, ringRadiusKm(minutes, props.mode))] },
      properties: { minutes },
    })),
  }
}

export default function MapLibreView(props: MapViewProps & { config: MapRuntimeConfig; onFailed: () => void }) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const latest = useRef(props)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    latest.current = props
  })

  useEffect(() => {
    if (!container.current) return
    const m = new maplibregl.Map({ container: container.current, style: mapStyleUrl(props.config), center: CENTRE, zoom: 10.4, attributionControl: { compact: true } })
    map.current = m
    m.on('error', (e) => {
      if (!m.loaded()) latest.current.onFailed()
      void e
    })
    m.on('load', () => {
      const gap = token('--lw-danger')
      const surplus = token('--lw-info')
      const balanced = token('--lw-success')
      const text = token('--lw-text')
      const surface = token('--lw-surface')
      const primary = token('--lw-primary')
      m.addSource('rings', { type: 'geojson', data: ringsGeoJson(latest.current) })
      m.addSource('staff', { type: 'geojson', data: staffGeoJson(latest.current) })
      m.addSource('stores', { type: 'geojson', data: storesGeoJson(latest.current) })
      m.addLayer({ id: 'rings-fill', type: 'fill', source: 'rings', paint: { 'fill-color': primary, 'fill-opacity': 0.08 } })
      m.addLayer({ id: 'rings-line', type: 'line', source: 'rings', paint: { 'line-color': primary, 'line-width': 2, 'line-dasharray': [2, 1] } })
      m.addLayer({
        id: 'staff',
        type: 'symbol',
        source: 'staff',
        layout: { 'text-field': ['get', 'label'], 'text-size': 12 },
        paint: { 'text-color': text, 'text-halo-color': surface, 'text-halo-width': 2 },
      })
      m.addLayer({
        id: 'stores',
        type: 'circle',
        source: 'stores',
        paint: {
          'circle-radius': ['case', ['get', 'selected'], 9, 7],
          'circle-color': ['match', ['get', 'status'], 'gap', gap, 'surplus', surplus, balanced],
          'circle-stroke-color': text,
          'circle-stroke-width': ['case', ['get', 'selected'], 3, 1],
        },
      })
      m.addLayer({
        id: 'store-labels',
        type: 'symbol',
        source: 'stores',
        layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'text-offset': [0, 1.3], 'text-anchor': 'top' },
        paint: { 'text-color': text, 'text-halo-color': surface, 'text-halo-width': 2 },
      })
      m.on('click', 'stores', (e) => {
        const id = e.features?.[0]?.properties?.id
        if (typeof id === 'string') latest.current.onSelect(id)
      })
      setReady(true)
    })
    return () => {
      m.remove()
      map.current = null
    }
    // The map is created once per config; data updates go through setData below.
  }, [props.config])

  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    ;(m.getSource('stores') as GeoJSONSource | undefined)?.setData(storesGeoJson(props))
    ;(m.getSource('staff') as GeoJSONSource | undefined)?.setData(staffGeoJson(props))
    ;(m.getSource('rings') as GeoJSONSource | undefined)?.setData(ringsGeoJson(props))
    m.setLayoutProperty('stores', 'visibility', props.layers.stores ? 'visible' : 'none')
    m.setLayoutProperty('store-labels', 'visibility', props.layers.stores ? 'visible' : 'none')
    m.setLayoutProperty('staff', 'visibility', props.layers.staff ? 'visible' : 'none')
    m.setLayoutProperty('rings-fill', 'visibility', props.layers.rings ? 'visible' : 'none')
    m.setLayoutProperty('rings-line', 'visibility', props.layers.rings ? 'visible' : 'none')
    const s = props.stores.find((x) => x.storeId === props.selectedId && x.site)
    if (s?.site) m.easeTo({ center: [s.site.lon, s.site.lat], duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 400 })
  }, [props, ready])

  return <div ref={container} className="size-full border-2 border-outline" aria-hidden="true" data-testid="maplibre-map" />
}
