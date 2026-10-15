/**
 * Runtime configuration, written to /runtime-config.json at deploy time from
 * the CDK stack outputs (infra/buildspec-cdk-deploy.yml). Every value is a
 * public identifier; the app client has no secret. Locally, VITE_* env vars.
 */
export interface AtriumConfig {
  readonly region: string
  readonly userPoolId: string
  readonly userPoolClientId: string
  readonly selfSignUp: boolean
  /** Atrium content API (decks). */
  readonly apiUrl: string | null
  /** LaneWise SPA origin, e.g. https://lanewise.prototypes.1cloudhub.com */
  readonly laneWiseUrl: string | null
}

const POOL_ID = /^[a-z]{2}(?:-[a-z]+)+-\d_[A-Za-z0-9]+$/
const CLIENT_ID = /^[a-z0-9]{1,128}$/

function httpsOrigin(v: unknown): string | null {
  if (typeof v !== 'string') return null
  try {
    const u = new URL(v)
    return u.protocol === 'https:' ? u.origin : null
  } catch {
    return null
  }
}

/** Validates an untrusted config object. Returns `null` when unusable. */
export function parseConfig(raw: unknown): AtriumConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const { userPoolId, userPoolClientId } = r
  if (typeof userPoolId !== 'string' || !POOL_ID.test(userPoolId)) return null
  if (typeof userPoolClientId !== 'string' || !CLIENT_ID.test(userPoolClientId)) return null
  const apiUrl = typeof r.apiUrl === 'string' && r.apiUrl.startsWith('https://') ? r.apiUrl.replace(/\/+$/, '') : null
  return {
    region: userPoolId.split('_')[0] as string,
    userPoolId,
    userPoolClientId,
    selfSignUp: r.selfSignUp === true || r.selfSignUp === 'true',
    apiUrl,
    laneWiseUrl: httpsOrigin(r.laneWiseUrl),
  }
}

export async function loadConfig(fetchImpl: typeof fetch = fetch): Promise<AtriumConfig | null> {
  try {
    const res = await fetchImpl('/runtime-config.json', { cache: 'no-store' })
    if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
      const parsed = parseConfig(await res.json())
      if (parsed) return parsed
    }
  } catch {
    // fall through to env vars
  }
  const env = import.meta.env
  return parseConfig({
    userPoolId: env.VITE_COGNITO_USER_POOL_ID,
    userPoolClientId: env.VITE_COGNITO_CLIENT_ID,
    selfSignUp: env.VITE_SELF_SIGN_UP,
    apiUrl: env.VITE_ATRIUM_API_URL,
    laneWiseUrl: env.VITE_LANEWISE_URL,
  })
}
