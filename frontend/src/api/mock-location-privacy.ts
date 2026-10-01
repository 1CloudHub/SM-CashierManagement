import {
  HTTP_STATUS_BY_ERROR_CODE,
  MAX_TRAVEL_MIN_BOUNDS,
  can,
  isConsentPurpose,
  type ApiErrorCode,
  type ApiErrorDetail,
  type BarangaySearchResponse,
  type ConsentLocale,
  type ConsentRecord,
  type ConsentStatus,
  type ConsentText,
  type MyConsentsResponse,
  type MyHomeAreaResponse,
  type RoleCode,
} from '@lanewise/shared'
import type { ApiResponse } from './client'
import { STF_STAFF_ID, WORLD_BARANGAYS, barangayByCode, demoNow, staffById } from './mock-world'

/**
 * In-memory `/me/consents` and `/me/home-area` for the mock API (task 15,
 * SCR-080 "Home area and shift offers"): the Staff persona has consented and
 * shares a barangay-level home area (never anything finer, P15). Only the
 * role that may share a home area (Staff, own record) reaches these routes,
 * like the API. Sample data — simulated, not SM actuals.
 */

const TEXT_VERSION = 1
const TEXT: Readonly<Record<ConsentLocale, string>> = {
  en: 'LaneWise uses the barangay you choose — never your street or exact address — to offer you open shifts at stores within your travel limit. You can stop sharing at any time; your home area is then removed from offers straight away.',
  fil: 'Ginagamit ng LaneWise ang barangay na pipiliin mo — hindi kailanman ang kalye o eksaktong address mo — para alukin ka ng mga bakanteng shift sa mga tindahang abot ng iyong limitasyon sa biyahe. Maaari kang huminto sa pagbabahagi anumang oras; aalisin agad ang iyong home area sa mga alok.',
}
const EFFECTIVE_FROM = '2026-06-01T00:00:00+08:00'
const GRANTED_AT = '2026-09-02T19:40:00+08:00'

let seq = 0
function fail(code: ApiErrorCode, message: string, details?: ApiErrorDetail[]): ApiResponse {
  seq += 1
  return { status: HTTP_STATUS_BY_ERROR_CODE[code], body: { error: { code, message, requestId: `mock-loc-${seq}`, ...(details ? { details } : {}) } } }
}
const ok = (body: unknown): ApiResponse => ({ status: 200, body })
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export interface MockLocationPrivacyStore {
  owns(pathname: string): boolean
  handle(input: { method: string; pathname: string; query: URLSearchParams; body: unknown; role: RoleCode }): ApiResponse
}

export function createLocationPrivacyStore(now: () => string = () => demoNow().toISOString()): MockLocationPrivacyStore {
  const self = staffById(STF_STAFF_ID)
  const history: ConsentRecord[] = [
    { id: 'consent-seed-1', purpose: 'home_area', textVersion: TEXT_VERSION, textLocale: 'en', grantedAt: GRANTED_AT, withdrawnAt: null, withdrawalReason: null },
  ]
  let area = self?.homeArea ? { code: self.homeArea, maxTravelMin: self.maxTravelMin, crossStoreOffers: self.crossStoreOffers, updatedAt: GRANTED_AT } : null

  const active = () => history.find((h) => h.withdrawnAt === null) ?? null
  const status = (): ConsentStatus => {
    const grant = active()
    return {
      purpose: 'home_area',
      active: grant !== null,
      grantedVersion: grant?.textVersion ?? null,
      grantedAt: grant?.grantedAt ?? null,
      currentVersion: TEXT_VERSION,
      reconsentRequired: false,
    }
  }
  const text = (locale: ConsentLocale): ConsentText => ({ purpose: 'home_area', version: TEXT_VERSION, locale, body: TEXT[locale], effectiveFrom: EFFECTIVE_FROM })
  const homeArea = (): MyHomeAreaResponse => {
    const b = area && active() ? barangayByCode(area.code) : undefined
    return {
      consent: status(),
      homeArea: area && b ? { barangay: { code: b.code, name: b.name, city: b.city }, maxTravelMin: area.maxTravelMin, crossStoreOffers: area.crossStoreOffers, updatedAt: area.updatedAt } : null,
    }
  }

  return {
    owns: (pathname) => pathname === '/me/consents' || pathname.startsWith('/me/consents/') || pathname === '/me/home-area' || pathname.startsWith('/me/home-area/'),
    handle({ method, pathname, query, body, role }) {
      if (!can(role, 'home_area_consent', 'edit')) return fail('forbidden', 'You do not have access to this resource.')
      if (pathname === '/me/consents') {
        if (method === 'GET') {
          const locale: ConsentLocale = query.get('locale') === 'fil' ? 'fil' : 'en'
          const res: MyConsentsResponse = { consents: [{ status: status(), text: text(locale), history: [...history] }] }
          return ok(res)
        }
        if (method !== 'POST') return fail('not_found', 'We couldn’t find that.')
        const b = isRecord(body) ? body : {}
        if (!isConsentPurpose(b.purpose) || b.version !== TEXT_VERSION) {
          return fail('validation_failed', 'Some fields are missing or invalid.', [{ path: 'body.version', message: 'Use the current consent text version.' }])
        }
        if (!active()) {
          seq += 1
          history.unshift({ id: `consent-${seq}`, purpose: 'home_area', textVersion: TEXT_VERSION, textLocale: b.locale === 'fil' ? 'fil' : 'en', grantedAt: now(), withdrawnAt: null, withdrawalReason: null })
        }
        return ok(status())
      }
      if (pathname.startsWith('/me/consents/')) {
        if (method !== 'DELETE') return fail('not_found', 'We couldn’t find that.')
        const grant = active()
        if (grant) history.splice(history.indexOf(grant), 1, { ...grant, withdrawnAt: now(), withdrawalReason: 'staff_withdrew' })
        area = null
        return ok(status())
      }
      if (pathname === '/me/home-area/barangays' && method === 'GET') {
        const q = (query.get('q') ?? '').trim().toLowerCase()
        const res: BarangaySearchResponse = {
          barangays: WORLD_BARANGAYS.filter((b) => q.length > 0 && `${b.name} ${b.city}`.toLowerCase().includes(q)).map(({ code, name, city }) => ({ code, name, city })),
        }
        return ok(res)
      }
      if (pathname !== '/me/home-area') return fail('not_found', 'We couldn’t find that.')
      if (method === 'GET') return ok(homeArea())
      if (method === 'DELETE') {
        area = null
        return ok(homeArea())
      }
      if (method !== 'PUT') return fail('not_found', 'We couldn’t find that.')
      if (!active()) return fail('conflict', 'Agree to share your home area first.')
      const b = isRecord(body) ? body : {}
      const minutes = b.maxTravelMin
      if (typeof b.barangayCode !== 'string' || !barangayByCode(b.barangayCode) || typeof minutes !== 'number' || minutes < MAX_TRAVEL_MIN_BOUNDS.min || minutes > MAX_TRAVEL_MIN_BOUNDS.max || typeof b.crossStoreOffers !== 'boolean') {
        return fail('validation_failed', 'Some fields are missing or invalid.', [{ path: 'body.barangayCode', message: 'Pick a barangay from the list.' }])
      }
      area = { code: b.barangayCode, maxTravelMin: minutes, crossStoreOffers: b.crossStoreOffers, updatedAt: now() }
      return ok(homeArea())
    },
  }
}
