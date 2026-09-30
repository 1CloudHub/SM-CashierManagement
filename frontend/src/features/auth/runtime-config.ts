/**
 * SPA runtime configuration (task 7).
 *
 * The deploy stage writes `/runtime-config.json` from the CDK stack outputs
 * (infra/buildspec-cdk-deploy.yml), so one SPA build runs in any environment.
 * For local development the same values can come from Vite env vars
 * (`VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`,
 * `VITE_SELF_SIGN_UP`, `VITE_API_URL`). Everything here is a public
 * identifier — the SPA's Cognito app client has no secret.
 */

export interface RuntimeAuthConfig {
  readonly userPoolId: string
  readonly userPoolClientId: string
  readonly selfSignUp: boolean
  readonly apiUrl: string | null
}

const POOL_ID = /^[a-z]{2}(?:-[a-z]+)+-\d_[A-Za-z0-9]+$/
const CLIENT_ID = /^[a-z0-9]{1,128}$/

/** Validates an untrusted config object. Returns `null` when unusable. */
export function parseRuntimeConfig(raw: unknown): RuntimeAuthConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const userPoolId = r.userPoolId
  const userPoolClientId = r.userPoolClientId
  if (typeof userPoolId !== 'string' || !POOL_ID.test(userPoolId)) return null
  if (typeof userPoolClientId !== 'string' || !CLIENT_ID.test(userPoolClientId)) return null
  const apiUrl = typeof r.apiUrl === 'string' && r.apiUrl.startsWith('https://') ? r.apiUrl : null
  return {
    userPoolId,
    userPoolClientId,
    selfSignUp: r.selfSignUp === true || r.selfSignUp === 'true',
    apiUrl,
  }
}

function fromViteEnv(): RuntimeAuthConfig | null {
  const env = import.meta.env
  return parseRuntimeConfig({
    userPoolId: env.VITE_COGNITO_USER_POOL_ID,
    userPoolClientId: env.VITE_COGNITO_CLIENT_ID,
    selfSignUp: env.VITE_SELF_SIGN_UP,
    apiUrl: env.VITE_API_URL,
  })
}

/**
 * Loads the runtime config: `/runtime-config.json` first, then Vite env vars.
 * Resolves `null` when neither is present/valid.
 */
export async function loadRuntimeConfig(
  fetchImpl: typeof fetch = fetch,
): Promise<RuntimeAuthConfig | null> {
  try {
    const res = await fetchImpl('/runtime-config.json', { cache: 'no-store' })
    const type = res.headers.get('content-type') ?? ''
    if (res.ok && type.includes('json')) {
      const parsed = parseRuntimeConfig(await res.json())
      if (parsed) return parsed
    }
  } catch {
    // Fall through to the build-time env (local dev).
  }
  return fromViteEnv()
}
