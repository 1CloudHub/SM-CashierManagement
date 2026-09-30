import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { ErrorPage } from './error-page'
import {
  BadRequestPage,
  NoAccessPage,
  NotFoundPage,
  NotSignedInPage,
  OfflinePage,
  ServerErrorPage,
  ServiceUnavailablePage,
  TooManyRequestsPage,
} from './pages'
import { generateReferenceId, kindHasReference } from './reference-id'
import { resolveErrorCopy, type ErrorKind } from './messages'

const ALL_KINDS: ErrorKind[] = [
  '400',
  '401',
  '403',
  '404',
  '429',
  '500',
  '503',
  'offline',
]

describe('ErrorPage — every kind (SCR-090)', () => {
  it.each(ALL_KINDS)(
    'renders a plain-language heading and at least one way back for %s',
    (kind) => {
      render(<ErrorPage kind={kind} />)
      const copy = resolveErrorCopy(kind, 'en')
      // Heading is present (StateBlock renders an <h2>).
      expect(
        screen.getByRole('heading', { name: new RegExp(copy.title, 'i') }),
      ).toBeInTheDocument()
      // No dead end: there is always at least one actionable control.
      const actions = [
        ...screen.queryAllByRole('button'),
        ...screen.queryAllByRole('link'),
      ]
      expect(actions.length).toBeGreaterThan(0)
    },
  )

  it('never leaks stack traces or object internals in the copy', () => {
    for (const kind of ALL_KINDS) {
      const copy = resolveErrorCopy(kind, 'en')
      const text = `${copy.title} ${copy.description}`.toLowerCase()
      expect(text).not.toMatch(/stack|trace|exception|null|undefined|0x[0-9a-f]/)
    }
  })
})

describe('Announced to assistive tech', () => {
  it('uses an assertive alert for server/offline faults', () => {
    render(<ErrorPage kind="500" />)
    const region = screen.getByRole('alert')
    expect(region).toHaveAttribute('aria-live', 'assertive')
  })

  it('uses a polite status region for 404 (not found)', () => {
    render(<ErrorPage kind="404" />)
    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-live', 'polite')
  })

  it('prefixes the heading with a visually-hidden error-page cue and code', () => {
    render(<ErrorPage kind="404" />)
    // The sr-only span carries the "Error page: 404." announcement.
    expect(screen.getByText(/error page:\s*404\./i)).toBeInTheDocument()
  })
})

describe('Reference IDs', () => {
  it('shows a generated reference for fault kinds (400/429/500/503/offline)', () => {
    for (const kind of ['400', '429', '500', '503', 'offline'] as ErrorKind[]) {
      const { unmount } = render(<ErrorPage kind={kind} />)
      expect(screen.getByText(/Reference ID:/i)).toBeInTheDocument()
      expect(screen.getByText(/^LW-[A-Z0-9]{6}$/)).toBeInTheDocument()
      unmount()
    }
  })

  it('omits a reference for expected outcomes (401/403/404) by default', () => {
    for (const kind of ['401', '403', '404'] as ErrorKind[]) {
      const { unmount } = render(<ErrorPage kind={kind} />)
      expect(screen.queryByText(/Reference ID:/i)).not.toBeInTheDocument()
      unmount()
    }
  })

  it('honours an explicit reference and can force it off with null', () => {
    const { rerender } = render(
      <ErrorPage kind="404" referenceId="LW-CUSTOM" />,
    )
    expect(screen.getByText('LW-CUSTOM')).toBeInTheDocument()

    rerender(<ErrorPage kind="500" referenceId={null} />)
    expect(screen.queryByText(/Reference ID:/i)).not.toBeInTheDocument()
  })

  it('generateReferenceId is opaque, prefixed and unambiguous', () => {
    const ref = generateReferenceId()
    expect(ref).toMatch(/^LW-[A-HJ-NP-Z2-9]{6}$/)
    expect(kindHasReference('500')).toBe(true)
    expect(kindHasReference('403')).toBe(false)
  })
})

describe('403 no-access reveals nothing (req. 2.4)', () => {
  it('shows only the generic message and a way Home', () => {
    render(<NoAccessPage />)
    expect(
      screen.getByRole('heading', { name: /do not have access/i }),
    ).toBeInTheDocument()
    // The only control is the recovery link.
    expect(screen.getByRole('link', { name: /go to home/i })).toBeInTheDocument()
    // No reference id (would be noise and could correlate a protected object).
    expect(screen.queryByText(/Reference ID:/i)).not.toBeInTheDocument()
  })
})

describe('Localisation (en / fil, placeholder bundle)', () => {
  it('renders Filipino copy and action labels when locale="fil"', () => {
    render(<ErrorPage kind="404" locale="fil" />)
    expect(
      screen.getByRole('heading', { name: /hindi namin makita/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /pumunta sa home/i }),
    ).toBeInTheDocument()
  })

  it('falls back to English copy for an unknown locale', () => {
    // @ts-expect-error — exercising the runtime fallback path.
    render(<ErrorPage kind="404" locale="xx" />)
    expect(
      screen.getByRole('heading', { name: /could not find that page/i }),
    ).toBeInTheDocument()
  })
})

describe('Recovery actions and wiring', () => {
  it('renders the primary action first with default hrefs', () => {
    render(<NotFoundPage />)
    const home = screen.getByRole('link', { name: /go to home/i })
    expect(home).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: /search/i })).toHaveAttribute(
      'href',
      '/search',
    )
  })

  it('lets a caller override hrefs (e.g. for the router base path)', () => {
    render(<NotFoundPage hrefs={{ home: '/app', search: '/app/search' }} />)
    expect(screen.getByRole('link', { name: /go to home/i })).toHaveAttribute(
      'href',
      '/app',
    )
  })

  it('intercepts navigation via onAction for client-side routing', async () => {
    const onAction = vi.fn()
    render(<NoAccessPage onAction={onAction} />)
    await userEvent.click(screen.getByRole('link', { name: /go to home/i }))
    expect(onAction).toHaveBeenCalledWith('home')
  })

  it('fires onAction for button actions (retry)', async () => {
    const onAction = vi.fn()
    render(<ServerErrorPage onAction={onAction} />)
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onAction).toHaveBeenCalledWith('retry')
  })

  it('401 offers sign-in as the way back', () => {
    render(<NotSignedInPage />)
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute(
      'href',
      '/sign-in',
    )
  })
})

describe('Layout', () => {
  it('bare layout wraps the block in a focusable main landmark', () => {
    render(<NotSignedInPage />)
    const main = screen.getByRole('main')
    expect(main).toHaveAttribute('id', 'main')
    expect(main).toHaveAttribute('tabindex', '-1')
  })

  it('inline layout renders no extra main landmark (sits in the shell)', () => {
    render(<ErrorPage kind="500" layout="inline" />)
    expect(screen.queryByRole('main')).not.toBeInTheDocument()
  })
})

describe('Named page wrappers map to the right kind', () => {
  it('each wrapper renders its own heading', () => {
    const cases: Array<[React.ReactElement, RegExp]> = [
      [<BadRequestPage />, /could not be understood/i],
      [<NotSignedInPage layout="inline" />, /please sign in/i],
      [<NoAccessPage />, /do not have access/i],
      [<NotFoundPage />, /could not find that page/i],
      [<TooManyRequestsPage />, /too many requests/i],
      [<ServerErrorPage />, /went wrong on our side/i],
      [<ServiceUnavailablePage />, /temporarily unavailable/i],
      [<OfflinePage />, /appear to be offline/i],
    ]
    for (const [el, re] of cases) {
      const { unmount } = render(el)
      expect(screen.getByRole('heading', { name: re })).toBeInTheDocument()
      unmount()
    }
  })
})

describe('Accessibility (axe)', () => {
  it.each(ALL_KINDS)('has no axe violations for %s', async (kind) => {
    const { container } = render(<ErrorPage kind={kind} />)
    expect(await axe(container)).toHaveNoViolations()
  })

  it('has no axe violations in the bare 401 layout', async () => {
    const { container } = render(<NotSignedInPage />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
