import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  can,
  MAP_DAY_PARTS,
  MAP_MAX_TRAVEL_CHOICES,
  MAP_TRAVEL_MODES,
  STORE_FORMATS,
  type MapDayPart,
  type MapTravelMode,
  type NetworkMapQuery,
  type NetworkMapResponse,
  type RoleCode,
  type StoreCandidatesResponse,
  type StoreFormat,
} from '@lanewise/shared'
import { useAnnouncer } from '@/components/a11y'
import { Cluster, Section, Sidebar, Stack } from '@/components/layout'
import { Alert, Button, Checkbox, Field, Input, Select, Skeleton, StateBlock } from '@/components/ui'
import { BarangayCountTable } from '@/features/location-privacy/barangay-count-table'
import { useI18n } from '@/i18n'
import { networkMapSearch, type NetworkMapApi } from './api'
import { AutoMatchDialog, type AutoMatchState } from './auto-match-dialog'
import { manilaToday } from './format'
import { staffByCity } from './geo'
import type { MapRuntimeConfig } from './map-config'
import { SchematicMap, type MapLayers } from './schematic-map'
import { StorePanel, type PanelState } from './store-panel'
import { StoresTable } from './stores-table'

const MapLibreView = lazy(() => import('./maplibre-map'))

type Load<T> = { state: 'loading' } | { state: 'error' } | { state: 'ready'; data: T }
type Keyed<T> = { readonly key: string; readonly ok: true; readonly data: T } | { readonly key: string; readonly ok: false }

export interface NetworkMapScreenProps {
  readonly api: NetworkMapApi
  readonly role: RoleCode
  /** Amazon Location settings; `null` → the schematic map (mock mode, tests, unconfigured). */
  readonly mapConfig: MapRuntimeConfig | null
  /** Defaults to today in Metro Manila. */
  readonly initialDate?: string
}

/**
 * SCR-026 Network map — Metro Manila (task 16.1, 16.4; requirement 11, 12).
 *
 * Stores as gap / surplus / balanced pins (shape + text + colour), cashiers
 * who share a home area counted per city on the map and per barangay in the
 * table, travel-time rings around the selected store, a store-format filter,
 * and the equivalent data tables. Selecting a store loads its ranked, eligible
 * candidates. "Auto-match all gaps" (Planner, Store Manager) opens the
 * network-wide proposal for review; sending is task 17.
 */
export function NetworkMapScreen({ api, role, mapConfig, initialDate }: NetworkMapScreenProps) {
  const { t } = useI18n()
  const { announce } = useAnnouncer()
  const [date, setDate] = useState(initialDate ?? manilaToday())
  const [dayPart, setDayPart] = useState<MapDayPart>('midday')
  const [mode, setMode] = useState<MapTravelMode>('public_transport')
  const [maxTravelMin, setMaxTravelMin] = useState<number>(30)
  const [department, setDepartment] = useState<string>('')
  const [formats, setFormats] = useState<readonly StoreFormat[]>([])
  const [layers, setLayers] = useState<MapLayers>({ stores: true, staff: true, rings: true })
  const [mapResult, setMapResult] = useState<Keyed<NetworkMapResponse> | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panelResult, setPanelResult] = useState<Keyed<StoreCandidatesResponse> | null>(null)
  const [autoOpen, setAutoOpen] = useState(false)
  const [auto, setAuto] = useState<AutoMatchState>({ state: 'loading' })
  const [realMapFailed, setRealMapFailed] = useState(false)

  const query = useMemo<NetworkMapQuery>(
    () => ({
      date,
      dayPart,
      mode,
      maxTravelMin,
      ...(department ? { department } : {}),
      ...(formats.length > 0 ? { formats } : {}),
    }),
    [date, dayPart, mode, maxTravelMin, department, formats],
  )
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
  const mapKey = `${networkMapSearch(query)}#${reloadKey}`

  // Results are keyed by the request that produced them, so a stale response
  // never shows for newer filters and "loading" is derived, not set.
  useEffect(() => {
    if (!validDate) return
    const ctrl = new AbortController()
    api.getMap(query, ctrl.signal).then(
      (data) => setMapResult({ key: mapKey, ok: true, data }),
      () => !ctrl.signal.aborted && setMapResult({ key: mapKey, ok: false }),
    )
    return () => ctrl.abort()
  }, [api, query, validDate, mapKey])

  const map = useMemo<Load<NetworkMapResponse>>(
    () =>
      mapResult === null || mapResult.key !== mapKey ? { state: 'loading' } : mapResult.ok ? { state: 'ready', data: mapResult.data } : { state: 'error' },
    [mapResult, mapKey],
  )
  const stores = useMemo(() => (map.state === 'ready' ? map.data.stores : []), [map])
  // Keep the selection only while the store is still on the map.
  const activeId = selectedId !== null && stores.some((s) => s.storeId === selectedId) ? selectedId : null
  const panelKey = activeId === null ? null : `${activeId}|${mapKey}`

  useEffect(() => {
    if (activeId === null || panelKey === null) return
    const ctrl = new AbortController()
    api.getCandidates(activeId, query, ctrl.signal).then(
      (data) => setPanelResult({ key: panelKey, ok: true, data }),
      () => !ctrl.signal.aborted && setPanelResult({ key: panelKey, ok: false }),
    )
    return () => ctrl.abort()
  }, [api, query, activeId, panelKey])

  const panel: PanelState =
    panelKey === null
      ? { state: 'idle' }
      : panelResult === null || panelResult.key !== panelKey
        ? { state: 'loading' }
        : panelResult.ok
          ? { state: 'ready', data: panelResult.data }
          : { state: 'error' }

  const select = useCallback(
    (storeId: string) => {
      setSelectedId(storeId)
      const name = stores.find((s) => s.storeId === storeId)?.name
      if (name) announce(`${t('map.pin.selected')}: ${name}`)
    },
    [stores, announce, t],
  )

  const openAutoMatch = () => {
    setAutoOpen(true)
    setAuto({ state: 'loading' })
    api.getAutoMatch(query).then(
      (data) => setAuto({ state: 'ready', data }),
      () => setAuto({ state: 'error' }),
    )
  }

  const departments = map.state === 'ready' ? map.data.departments : []
  const departmentName = (key: string) => departments.find((d) => d.key === key)?.name ?? key
  const rings = map.state === 'ready' ? map.data.rings : []
  const staff = map.state === 'ready' ? staffByCity(map.data.staffLayer) : []
  const canAutoMatch = can(role, 'shift_offers_send', 'edit')
  const useRealMap = mapConfig !== null && !realMapFailed
  const mapProps = { stores, staff, layers, rings, mode, selectedId: activeId, onSelect: select }

  const filters = (
    <Section title={t('map.filters.title')} titleAs="h2">
      <Cluster gap={4} align="end">
        <Field label={t('map.filters.date')} error={validDate ? undefined : t('map.filters.dateInvalid')}>
          {(aria) => <Input {...aria} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <Field label={t('map.filters.dayPart')}>
          {(aria) => (
            <Select {...aria} value={dayPart} onChange={(e) => setDayPart(e.target.value as MapDayPart)}>
              {MAP_DAY_PARTS.map((p) => (
                <option key={p} value={p}>
                  {t(`map.dayPart.${p}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('map.filters.department')}>
          {(aria) => (
            <Select {...aria} value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">{t('map.filters.allDepartments')}</option>
              {departments.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('map.filters.mode')}>
          {(aria) => (
            <Select {...aria} value={mode} onChange={(e) => setMode(e.target.value as MapTravelMode)}>
              {MAP_TRAVEL_MODES.map((m) => (
                <option key={m} value={m}>
                  {t(`map.mode.${m}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('map.filters.maxTravel')}>
          {(aria) => (
            <Select {...aria} value={String(maxTravelMin)} onChange={(e) => setMaxTravelMin(Number(e.target.value))}>
              {MAP_MAX_TRAVEL_CHOICES.map((m) => (
                <option key={m} value={m}>
                  {t('map.filters.minutes', { minutes: m })}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-label text-text">{t('map.filters.formats')}</legend>
          <Cluster gap={3}>
            {STORE_FORMATS.map((f) => (
              <Checkbox
                key={f}
                className="text-body-sm"
                label={t(`map.format.${f}`)}
                checked={formats.length === 0 || formats.includes(f)}
                onChange={(e) => {
                  const current = formats.length === 0 ? [...STORE_FORMATS] : [...formats]
                  const next = e.target.checked ? [...new Set([...current, f])] : current.filter((x) => x !== f)
                  setFormats(next.length === STORE_FORMATS.length ? [] : next)
                }}
              />
            ))}
          </Cluster>
        </fieldset>
      </Cluster>
    </Section>
  )

  const layerToggles = (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-label text-text">{t('map.layers.title')}</legend>
      <Cluster gap={3}>
        {(['stores', 'staff', 'rings'] as const).map((k) => (
          <Checkbox
            key={k}
            className="text-body-sm"
            label={t(`map.layers.${k}`)}
            checked={layers[k]}
            onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })}
          />
        ))}
      </Cluster>
    </fieldset>
  )

  let body: React.ReactNode
  if (map.state === 'loading') {
    body = (
      <Stack gap={3} aria-busy="true">
        <Skeleton className="aspect-video w-full" />
        <Skeleton className="h-40 w-full" />
      </Stack>
    )
  } else if (map.state === 'error') {
    body = <StateBlock variant="error" title={t('map.loadFailed')} action={<Button onClick={() => setReloadKey((k) => k + 1)}>{t('map.retry')}</Button>} />
  } else if (map.data.stores.length === 0) {
    body = <StateBlock variant="empty" title={t('map.empty.title')} description={t('map.empty.description')} />
  } else {
    body = (
      <Sidebar
        sideLabel={t('map.panel.label')}
        sideWidth="26rem"
        side={
          <Section title={t('map.panel.label')} titleAs="h2">
            <StorePanel key={activeId ?? 'none'} panel={panel} query={query} departmentName={departmentName} />
          </Section>
        }
      >
        <Stack gap={4}>
          <section aria-labelledby="network-map-region" className="flex flex-col gap-2">
            <h2 id="network-map-region" className="text-h3 text-text">
              {t('map.region')}
            </h2>
            <p className="text-body-sm text-text-muted">{t('map.region.description', { count: map.data.stores.length })}</p>
            <Cluster gap={4} justify="between" align="end">
              {layerToggles}
              {canAutoMatch && (
                <Button variant="primary" onClick={openAutoMatch}>
                  {t('map.autoMatch.button')}
                </Button>
              )}
            </Cluster>
            {useRealMap ? (
              <div className="aspect-video w-full">
                <Suspense fallback={<Skeleton className="size-full" />}>
                  <MapLibreView {...mapProps} config={mapConfig} onFailed={() => setRealMapFailed(true)} />
                </Suspense>
              </div>
            ) : (
              <SchematicMap {...mapProps} />
            )}
            {realMapFailed && <Alert tone="warning">{t('map.real.failed')}</Alert>}
            <div className="flex flex-col gap-1 text-caption text-text">
              <span className="text-label">{t('map.legend.title')}</span>
              <Cluster gap={3}>
                <span>{t('map.legend.gap')}</span>
                <span>{t('map.legend.surplus')}</span>
                <span>{t('map.legend.balanced')}</span>
                <span>{t('map.legend.staff')}</span>
                {rings.length === 3 && <span>{t('map.legend.rings', { a: rings[0]!, b: rings[1]!, c: rings[2]! })}</span>}
              </Cluster>
              <span className="text-text-muted">{t(useRealMap ? 'map.real.note' : 'map.schematic.note')}</span>
            </div>
          </section>
          <StoresTable stores={map.data.stores} selectedId={activeId} onSelect={select} />
          <BarangayCountTable counts={map.data.staffLayer} />
        </Stack>
      </Sidebar>
    )
  }

  return (
    <Stack gap={4}>
      <Stack gap={1}>
        <h1 className="text-h1 text-text">{t('map.title')}</h1>
        <p className="text-body text-text-muted">{t('map.intro')}</p>
      </Stack>
      {filters}
      {map.state === 'ready' && map.data.gapsSource === 'published_roster' && <Alert tone="info">{t('map.gapsSource.publishedRoster')}</Alert>}
      {body}
      {canAutoMatch && <AutoMatchDialog open={autoOpen} onOpenChange={setAutoOpen} result={auto} />}
    </Stack>
  )
}
