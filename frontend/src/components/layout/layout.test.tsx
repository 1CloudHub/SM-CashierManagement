import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { AppShell } from './app-shell'
import { Cluster } from './cluster'
import { Col, Grid } from './grid'
import { DensityProvider } from './density'
import { useDensity } from './density-context'
import { Page } from './page'
import { Section } from './section'
import { Sidebar, Split } from './split'
import { Stack } from './stack'
import type { NavSection } from '@/components/shell/side-nav'

const NAV: NavSection[] = [
  { items: [{ label: 'Home', href: '#home', icon: '⌂', current: true }] },
  {
    title: 'Plan',
    items: [
      { label: 'Network view', href: '#net', icon: 'N' },
      { label: 'Weekly roster', href: '#ros', icon: 'R' },
    ],
  },
]

/** Stub matchMedia to a fixed match result so the shell picks a known layout. */
function setViewport(matches: (query: string) => boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: matches(query),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

describe('Page', () => {
  it('renders a centred container and can be the main landmark', () => {
    render(
      <Page as="main" width="desktop">
        <p>Body</p>
      </Page>,
    )
    const main = screen.getByRole('main')
    expect(main).toHaveClass('mx-auto')
    expect(main).toHaveTextContent('Body')
  })
})

describe('Grid / Col', () => {
  it('applies responsive span classes against each breakpoint column count', () => {
    render(
      <Grid data-testid="grid">
        <Col data-testid="col" span={2} spanTablet={4} spanLaptop={8}>
          cell
        </Col>
      </Grid>,
    )
    expect(screen.getByTestId('grid')).toHaveClass('lw-grid')
    const col = screen.getByTestId('col')
    expect(col.className).toContain('col-span-2')
    expect(col.className).toContain('tablet:col-span-4')
    expect(col.className).toContain('laptop:col-span-8')
  })
})

describe('Stack / Cluster polymorphism', () => {
  it('renders as the requested element with the right attributes (no tsc/DOM mismatch)', () => {
    render(
      <>
        <Stack as="ul" aria-label="Items" data-testid="stack">
          <li>one</li>
        </Stack>
        <Cluster as="nav" aria-label="Toolbar" data-testid="cluster">
          <button>Act</button>
        </Cluster>
      </>,
    )
    const stack = screen.getByTestId('stack')
    expect(stack.tagName).toBe('UL')
    expect(stack).toHaveAttribute('aria-label', 'Items')
    // A nav element with an accessible name is a navigation landmark.
    expect(
      screen.getByRole('navigation', { name: 'Toolbar' }),
    ).toBeInTheDocument()
  })
})

describe('Split / Sidebar', () => {
  it('exposes the docked side track as a labelled complementary region', () => {
    render(
      <Sidebar side={<p>Filters</p>} sideLabel="Filters">
        <p>Main content</p>
      </Sidebar>,
    )
    const aside = screen.getByRole('complementary', { name: 'Filters' })
    expect(aside).toHaveTextContent('Filters')
  })

  it('Split passes through the side-width custom property', () => {
    render(<Split data-testid="split" sideWidth="24rem" />)
    expect(screen.getByTestId('split')).toHaveStyle({ '--side-w': '24rem' })
  })
})

describe('Section', () => {
  it('is a region labelled by its heading', () => {
    render(
      <Section title="KPI cards" titleAs="h2">
        <p>content</p>
      </Section>,
    )
    const region = screen.getByRole('region', { name: 'KPI cards' })
    expect(
      within(region).getByRole('heading', { name: 'KPI cards', level: 2 }),
    ).toBeInTheDocument()
  })
})

function DensityProbe() {
  const density = useDensity()
  return <span>density:{density}</span>
}

describe('Density', () => {
  it('provides a compact density to descendants and reflects it on the wrapper', () => {
    const { container } = render(
      <DensityProvider density="compact">
        <DensityProbe />
      </DensityProvider>,
    )
    expect(screen.getByText('density:compact')).toBeInTheDocument()
    expect(container.querySelector('[data-density="compact"]')).not.toBeNull()
  })
})

const SEARCH = (
  <form role="search">
    <label htmlFor="q" className="sr-only">
      Search
    </label>
    <input id="q" type="search" />
  </form>
)

describe('AppShell (mobile < tablet)', () => {
  beforeEach(() => {
    // No media query matches → mobile: drawer nav + full-screen search.
    setViewport(() => false)
  })

  it('renders the banner, main and breadcrumb landmarks', () => {
    render(
      <AppShell
        nav={NAV}
        search={SEARCH}
        breadcrumbs={[{ label: 'Home', href: '#' }, { label: 'Network view' }]}
      >
        <h1>Network view</h1>
      </AppShell>,
    )
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(
      screen.getByRole('navigation', { name: 'Breadcrumb' }),
    ).toBeInTheDocument()
  })

  it('opens the nav drawer from the menu toggle and the full-screen search dialog', async () => {
    render(
      <AppShell nav={NAV} search={SEARCH}>
        <h1>Home</h1>
      </AppShell>,
    )
    const toggle = screen.getByRole('button', { name: 'Open navigation' })
    expect(toggle).toHaveAttribute('aria-controls', 'sidenav')
    await userEvent.click(toggle)
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' })
    expect(
      within(drawer).getByRole('link', { name: 'Network view' }),
    ).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')

    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(
      await screen.findByRole('dialog', { name: 'Search' }),
    ).toBeInTheDocument()
  })

  it('has no axe violations', async () => {
    const { container } = render(
      <AppShell
        nav={NAV}
        search={SEARCH}
        breadcrumbs={[{ label: 'Home', href: '#' }, { label: 'Network view' }]}
        sampleDataBanner={
          <div role="note">Sample data — figures are simulated.</div>
        }
      >
        <h1>Network view</h1>
        <Section title="KPI cards">
          <Grid>
            <Col span={2} spanTablet={4} spanLaptop={3}>
              <p>KPI</p>
            </Col>
          </Grid>
        </Section>
      </AppShell>,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('AppShell (laptop and up)', () => {
  beforeEach(() => {
    // Both breakpoints match → expanded docked nav, no drawer/search toggle.
    setViewport(() => true)
  })

  it('docks a single expanded navigation landmark beside content', () => {
    render(
      <AppShell nav={NAV} search={SEARCH}>
        <h1>Network view</h1>
      </AppShell>,
    )
    // Exactly one "Main" navigation landmark (the docked nav) — unique.
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Network view' }),
    ).toBeInTheDocument()
    // The TopBar toggle stays in the DOM (hidden via CSS at tablet+); the
    // docked nav is what users interact with here.
    expect(
      screen.queryByRole('button', { name: 'Open navigation' }),
    ).toBeInTheDocument()
  })

  it('has no axe violations with the docked nav', async () => {
    const { container } = render(
      <AppShell
        nav={NAV}
        search={SEARCH}
        breadcrumbs={[{ label: 'Home', href: '#' }, { label: 'Network view' }]}
      >
        <h1>Network view</h1>
      </AppShell>,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('AppShell (laptop) collapsible nav', () => {
  beforeEach(() => {
    setViewport(() => true)
    window.localStorage.clear()
  })

  it('collapses and expands the docked nav from its icon toggle and remembers the choice', async () => {
    const { unmount } = render(
      <AppShell nav={NAV}>
        <h1>Home</h1>
      </AppShell>,
    )
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByText('Network view')).toBeVisible()

    const collapse = screen.getByRole('button', { name: 'Collapse navigation' })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(collapse)

    expect(nav).toHaveAttribute('data-collapsed', 'true')
    expect(within(nav).queryByText('Network view')).not.toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Network view' })).toBeInTheDocument()
    expect(window.localStorage.getItem('lw.nav.collapsed')).toBe('true')
    unmount()

    render(
      <AppShell nav={NAV}>
        <h1>Home</h1>
      </AppShell>,
    )
    const expand = screen.getByRole('button', { name: 'Expand navigation' })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(expand)
    expect(screen.getByRole('navigation', { name: 'Main' })).not.toHaveAttribute('data-collapsed')
  })
})
