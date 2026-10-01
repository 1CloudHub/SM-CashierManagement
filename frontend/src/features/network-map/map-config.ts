/**
 * Amazon Location Service map settings for the network map (task 16.1).
 *
 * The deploy writes `map: { region, mapName, apiKey }` into
 * `/runtime-config.json` (infra/buildspec-cdk-deploy.yml): the map name and a
 * referer-restricted, read-only browser key. Locally the same can come from
 * `VITE_MAP_REGION` / `VITE_MAP_NAME` / `VITE_MAP_API_KEY`. In mock mode, in
 * tests, or when nothing is configured the screen uses its schematic map,
 * which needs no network.
 */
export interface MapRuntimeConfig {
  readonly region: string
  readonly mapName: string
  readonly apiKey: string
}

const REGION = /^[a-z]{2}(?:-[a-z]+)+-\d$/
const MAP_NAME = /^[-._A-Za-z0-9]{1,100}$/
const API_KEY = /^[-._+/=A-Za-z0-9]{8,512}$/

/** Validates an untrusted `map` object. Returns `null` when unusable. */
export function parseMapConfig(raw: unknown): MapRuntimeConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const { region, mapName, apiKey } = raw as Record<string, unknown>
  if (typeof region !== 'string' || !REGION.test(region)) return null
  if (typeof mapName !== 'string' || !MAP_NAME.test(mapName)) return null
  if (typeof apiKey !== 'string' || !API_KEY.test(apiKey)) return null
  return { region, mapName, apiKey }
}

/** The MapLibre style URL for an Amazon Location map. */
export function mapStyleUrl(config: MapRuntimeConfig): string {
  return `https://maps.geo.${config.region}.amazonaws.com/maps/v0/maps/${encodeURIComponent(config.mapName)}/style-descriptor?key=${encodeURIComponent(config.apiKey)}`
}

/**
 * Loads the map settings: `/runtime-config.json` → `map`, then Vite env vars.
 * Resolves `null` in mock mode or when neither is present/valid.
 */
export async function loadMapConfig(
  options: { readonly mock: boolean; readonly fetch?: typeof fetch; readonly env?: Record<string, unknown> },
): Promise<MapRuntimeConfig | null> {
  if (options.mock) return null
  const fetchImpl = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  try {
    const res = await fetchImpl('/runtime-config.json', { cache: 'no-store' })
    if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
      const parsed = parseMapConfig(((await res.json()) as { map?: unknown }).map)
      if (parsed) return parsed
    }
  } catch {
    // Fall through to the build-time env (local dev).
  }
  const env = options.env ?? import.meta.env
  return parseMapConfig({ region: env.VITE_MAP_REGION, mapName: env.VITE_MAP_NAME, apiKey: env.VITE_MAP_API_KEY })
}
