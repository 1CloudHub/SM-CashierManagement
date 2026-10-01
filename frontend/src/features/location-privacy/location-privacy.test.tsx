import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import fc from 'fast-check'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import {
  FINE_LOCATION_KEYS,
  type BarangayRef,
  type ConsentRecord,
  type ConsentStatus,
  type MyConsentsResponse,
  type MyHomeAreaResponse,
  type StaffHomeAreaResponse,
} from '@lanewise/shared'
import { ApiError, ApiProvider, createApiClient, type ApiAdapter, type ApiRequest } from '@/api'
import { ActiveRoleProvider } from '@/app/active-role'
import { AnnouncerProvider } from '@/components/a11y'
import { I18nProvider } from '@/i18n'
import {
  BarangayCountTable,
  HomeAreaSection,
  LocationPrivacyProvider,
  ProfileHomeArea,
  StaffHomeAreaPanel,
  createApiLocationPrivacyClient,
  type LocationPrivacyClient,
} from '.'

const PAG_ASA: BarangayRef = { code: '137404001', name: 'Bagong Pag-asa', city: 'Quezon City' }
const WACK: BarangayRef = { code: '137401002', name: 'Wack-Wack Greenhills', city: 'Mandaluyong' }
const CONSENT_TEXT = 'I agree that SM Retail may use my home barangay (never my address).'

/** In-memory fake of the API with the server's consent rules. */
function fakeClient(options: { reconsent?: boolean; failLoad?: boolean } = {}) {
  let status: ConsentStatus = {
    purpose: 'home_area',
    active: false,
    grantedVersion: options.reconsent ? 1 : null,
    grantedAt: options.reconsent ? '2026-09-01T00:00:00.000Z' : null,
    currentVersion: options.reconsent ? 2 : 1,
    reconsentRequired: options.reconsent ?? false,
  }
  let homeArea: MyHomeAreaResponse['homeArea'] = null
  const history: ConsentRecord[] = []
  const home = (): MyHomeAreaResponse => ({ consent: status, homeArea: status.active ? homeArea : null })
  const client = {
    getMyConsents: vi.fn(async (locale): Promise<MyConsentsResponse> => {
      if (options.failLoad) throw new Error('down')
      return {
        consents: [
          {
            status,
            text: { purpose: 'home_area', version: status.currentVersion, locale, body: CONSENT_TEXT, effectiveFrom: '1970-01-01T00:00:00.000Z' },
            history: [...history],
          },
        ],
      }
    }),
    grantConsent: vi.fn(async (_p, version: number, locale) => {
      if (version !== status.currentVersion) throw new ApiError(409, 'conflict', 'Changed.', 'r1')
      status = { ...status, active: true, grantedVersion: version, grantedAt: '2026-09-30T00:00:00.000Z', reconsentRequired: false }
      history.unshift({ id: `c${history.length}`, purpose: 'home_area', textVersion: version, textLocale: locale, grantedAt: status.grantedAt ?? '', withdrawnAt: null, withdrawalReason: null })
      return status
    }),
    withdrawConsent: vi.fn(async () => {
      status = { ...status, active: false, grantedVersion: null, grantedAt: null }
      homeArea = null
      const [latest] = history
      if (latest) history[0] = { ...latest, withdrawnAt: '2026-09-30T01:00:00.000Z', withdrawalReason: 'staff_withdrew' }
      return status
    }),
    getMyHomeArea: vi.fn(async () => home()),
    setMyHomeArea: vi.fn(async (input) => {
      const barangay = [PAG_ASA, WACK].find((b) => b.code === input.barangayCode)
      if (!barangay) throw new ApiError(422, 'validation_failed', 'Invalid.', 'r2')
      homeArea = { barangay, maxTravelMin: input.maxTravelMin, crossStoreOffers: input.crossStoreOffers, updatedAt: '2026-09-30T00:00:00.000Z' }
      return home()
    }),
    clearMyHomeArea: vi.fn(async () => {
      homeArea = null
      return home()
    }),
    searchBarangays: vi.fn(async (q: string) =>
      [PAG_ASA, WACK].filter((b) => b.name.toLowerCase().includes(q.toLowerCase())),
    ),
    getStaffHomeArea: vi.fn(async (staffId: string): Promise<StaffHomeAreaResponse> => ({ staffId, shared: false })),
  } satisfies LocationPrivacyClient
  return client
}

function renderWith(ui: ReactNode, client: LocationPrivacyClient, locale: 'en' | 'fil' = 'en') {
  return render(
    <I18nProvider initialLocale={locale}>
      <AnnouncerProvider>
        <LocationPrivacyProvider client={client}>{ui}</LocationPrivacyProvider>
      </AnnouncerProvider>
    </I18nProvider>,
  )
}

describe('SCR-080 Home area and shift offers', () => {
  it('asks for opt-in consent to the versioned text before anything is shared', async () => {
    const user = userEvent.setup()
    const client = fakeClient()
    const { container } = renderWith(<HomeAreaSection />, client)

    expect(await screen.findByText(CONSENT_TEXT)).toBeInTheDocument()
    expect(screen.getByText('Consent text version 1')).toBeInTheDocument()
    expect(screen.queryByLabelText(/^home barangay/i)).toBeNull()
    const agree = screen.getByRole('button', { name: 'Agree and share my home area' })
    expect(agree).toBeDisabled()
    expect(await axe(container)).toHaveNoViolations()

    await user.click(screen.getByLabelText(/I have read this/))
    await user.click(agree)
    expect(client.grantConsent).toHaveBeenCalledWith('home_area', 1, 'en')
    expect(await screen.findByLabelText(/^home barangay/i)).toBeInTheDocument()
  })

  it('sends the consent in the UI language', async () => {
    const user = userEvent.setup()
    const client = fakeClient()
    renderWith(<HomeAreaSection />, client, 'fil')
    await screen.findByText(CONSENT_TEXT)
    expect(client.getMyConsents).toHaveBeenCalledWith('fil')
    await user.click(screen.getByLabelText(/Nabasa ko ito/))
    await user.click(screen.getByRole('button', { name: 'Pumayag at ibahagi ang home area' }))
    expect(client.grantConsent).toHaveBeenCalledWith('home_area', 1, 'fil')
  })

  it('picks a barangay from the reference list and saves only code, travel and cross-store', async () => {
    const user = userEvent.setup()
    const client = fakeClient()
    const { container } = renderWith(<HomeAreaSection />, client)
    await screen.findByText(CONSENT_TEXT)
    await user.click(screen.getByLabelText(/I have read this/))
    await user.click(screen.getByRole('button', { name: 'Agree and share my home area' }))

    // Saving without a barangay is refused with a field error.
    await user.click(await screen.findByRole('button', { name: 'Save home area' }))
    expect(await screen.findByText('Choose your home barangay from the list.')).toBeInTheDocument()
    expect(client.setMyHomeArea).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Search barangays'), 'pag')
    await waitFor(() => expect(screen.getByRole('option', { name: 'Bagong Pag-asa, Quezon City' })).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText(/^home barangay/i), PAG_ASA.code)
    await user.selectOptions(screen.getByLabelText('Max travel'), '45')
    await user.click(screen.getByLabelText('Send me open-shift offers from other stores'))
    await user.click(screen.getByRole('button', { name: 'Save home area' }))

    await waitFor(() =>
      expect(client.setMyHomeArea).toHaveBeenCalledWith({ barangayCode: PAG_ASA.code, maxTravelMin: 45, crossStoreOffers: true }),
    )
    expect(await screen.findByText('Currently shared: Bagong Pag-asa, Quezon City')).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('stop sharing confirms, withdraws consent and returns to the consent prompt', async () => {
    const user = userEvent.setup()
    const client = fakeClient()
    renderWith(<HomeAreaSection />, client)
    await screen.findByText(CONSENT_TEXT)
    await user.click(screen.getByLabelText(/I have read this/))
    await user.click(screen.getByRole('button', { name: 'Agree and share my home area' }))

    await user.click(await screen.findByRole('button', { name: 'Stop sharing my home area' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/deleted right away/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Stop sharing' }))

    expect(client.withdrawConsent).toHaveBeenCalledWith('home_area')
    expect(await screen.findByRole('button', { name: 'Agree and share my home area' })).toBeInTheDocument()
    expect(screen.queryByLabelText(/^home barangay/i)).toBeNull()
    expect(screen.getByRole('table', { name: 'Consent history' })).toHaveTextContent('You stopped sharing')
  })

  it('asks for fresh consent when the text changed', async () => {
    renderWith(<HomeAreaSection />, fakeClient({ reconsent: true }))
    expect(await screen.findByText('The consent text has changed')).toBeInTheDocument()
    expect(screen.getByText('Consent text version 2')).toBeInTheDocument()
  })

  it('shows a retryable error when loading fails', async () => {
    renderWith(<HomeAreaSection />, fakeClient({ failLoad: true }))
    expect(await screen.findByText('We couldn’t load your home area settings.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

describe('SCR-053 staff home area', () => {
  it('shows the barangay only, when shared', async () => {
    const client = fakeClient()
    client.getStaffHomeArea.mockResolvedValue({ staffId: 's1', shared: true, barangay: WACK, maxTravelMin: 30, crossStoreOffers: false })
    const { container } = renderWith(<StaffHomeAreaPanel staffId="s1" />, client)
    expect(await screen.findByText('Wack-Wack Greenhills, Mandaluyong')).toBeInTheDocument()
    expect(screen.getByText('30 min')).toBeInTheDocument()
    expect(screen.getByText('No')).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('says “not shared” and nothing else when there is no consent', async () => {
    renderWith(<StaffHomeAreaPanel staffId="s2" />, fakeClient())
    expect(await screen.findByText(/Not shared\./)).toBeInTheDocument()
    expect(screen.queryByText(/Barangay$/)).toBeNull()
  })

  it('shows no access on 403 without revealing anything', async () => {
    const client = fakeClient()
    client.getStaffHomeArea.mockRejectedValue(new ApiError(403, 'forbidden', 'No access.', 'r3'))
    renderWith(<StaffHomeAreaPanel staffId="s3" />, client)
    expect(await screen.findByText('You don’t have access to this staff member’s home area.')).toBeInTheDocument()
  })
})

describe('SCR-026 home-area counts table', () => {
  it('lists counts per barangay only', async () => {
    const { container } = renderWith(
      <BarangayCountTable counts={[{ barangay: PAG_ASA, count: 3 }, { barangay: WACK, count: 1 }]} />,
      fakeClient(),
    )
    const table = screen.getByRole('table', { name: 'Consenting cashiers counted per barangay' })
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(table).toHaveTextContent('Bagong Pag-asa')
    expect(await axe(container)).toHaveNoViolations()
  })

  it('has an empty state', () => {
    renderWith(<BarangayCountTable counts={[]} />, fakeClient())
    expect(screen.getByText('No cashiers in scope have shared a home area.')).toBeInTheDocument()
  })
})

describe('API client', () => {
  /** A transport that records requests and answers with `status` / `body`. */
  function adapter(status: number, body: unknown) {
    const log: ApiRequest[] = []
    const fn: ApiAdapter = async (request) => {
      log.push(request)
      return { status, body }
    }
    return { fn, log }
  }
  const clientOver = (fn: ApiAdapter, token: string | null = null) =>
    createApiLocationPrivacyClient(createApiClient({ adapter: fn, getActiveRole: () => 'STF', getAuthToken: async () => token }))

  it('calls the task 15 routes with the active role and the ID token', async () => {
    const { fn, log } = adapter(200, { consent: {}, homeArea: null })
    await clientOver(fn, 'tok').setMyHomeArea({ barangayCode: PAG_ASA.code, maxTravelMin: 30, crossStoreOffers: false })
    expect(log).toEqual([
      {
        method: 'PUT',
        path: '/me/home-area',
        headers: { Accept: 'application/json', 'X-Active-Role': 'STF', Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
        body: { barangayCode: PAG_ASA.code, maxTravelMin: 30, crossStoreOffers: false },
        signal: undefined,
      },
    ])
  })

  it('maps API errors to ApiError with their code', async () => {
    const { fn } = adapter(409, { error: { code: 'conflict', message: 'x', requestId: 'r' } })
    await expect(clientOver(fn).withdrawConsent('home_area')).rejects.toMatchObject({ status: 409, code: 'conflict' })
  })

  it('P15: refuses to pass on any response carrying location finer than barangay', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...FINE_LOCATION_KEYS), async (key) => {
        const { fn } = adapter(200, { staffId: 's', shared: true, barangay: { ...PAG_ASA, [key]: 1 } })
        await expect(clientOver(fn).getStaffHomeArea('s')).rejects.toThrow(/finer than barangay/)
      }),
    )
  })
})

describe('SCR-080 wiring (ProfileHomeArea)', () => {
  function renderProfile(role: 'STF' | 'PLN') {
    const { fn, log } = failingAdapter()
    render(
      <I18nProvider initialLocale="en">
        <AnnouncerProvider>
          <ActiveRoleProvider demo={false} assignedRoles={[role]}>
            <ApiProvider adapter={fn}>
              <ProfileHomeArea />
            </ApiProvider>
          </ActiveRoleProvider>
        </AnnouncerProvider>
      </I18nProvider>,
    )
    return log
  }
  function failingAdapter() {
    const log: ApiRequest[] = []
    const fn: ApiAdapter = async (request) => {
      log.push(request)
      return { status: 503, body: { error: { code: 'service_unavailable', message: 'down', requestId: 'r' } } }
    }
    return { fn, log }
  }

  it('loads the home-area section for Staff through the app API client', async () => {
    const log = renderProfile('STF')
    await waitFor(() => expect(log.map((r) => `${r.method} ${r.path}`)).toContain('GET /me/consents?locale=en'))
    expect(log.every((r) => r.headers['X-Active-Role'] === 'STF')).toBe(true)
  })

  it('renders nothing and calls nothing for roles that cannot share a home area', async () => {
    const log = renderProfile('PLN')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(log).toEqual([])
  })
})
