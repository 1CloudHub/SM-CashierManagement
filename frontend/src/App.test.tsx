import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { App } from './App'

/**
 * Smoke + a11y test for the component gallery / design-system reference
 * (task 1.10). Confirms the gallery composes into a navigable screen with the
 * expected landmarks, the section index, the UX-010 states and no axe
 * violations — so the design system is usable end to end (UX-001/004/010).
 *
 * Full WCAG conformance still requires manual assistive-technology testing;
 * this establishes the structure and catches regressions automatically.
 */

/** Force a laptop-and-up viewport so the AppShell docks its expanded nav. */
function setLaptopViewport() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

describe('App (component gallery)', () => {
  beforeEach(() => {
    setLaptopViewport()
  })

  it('renders the core landmarks and title', () => {
    render(<App />)
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(
      screen.getByRole('navigation', { name: 'Component gallery' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: /component gallery/i }),
    ).toBeInTheDocument()
  })

  it('exposes the full section index in the nav', () => {
    render(<App />)
    const nav = screen.getByRole('navigation', { name: 'Component gallery' })
    for (const label of [
      'Foundations',
      'Primitives',
      'States',
      'Layout',
      'Patterns',
      'Error pages',
    ]) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('documents each section as a labelled region', () => {
    render(<App />)
    // Each gallery section is a <section> landmark named by its heading.
    for (const name of [
      /^Foundations$/,
      /^Primitives$/,
      /^States$/,
      /^Layout$/,
      /^Patterns$/,
      /^Error pages$/,
    ]) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument()
    }
  })

  it('shows the full set of UX-010 states', () => {
    render(<App />)
    // no-access reveals nothing but its message
    expect(
      screen.getByRole('heading', { name: /don’t have access/i }),
    ).toBeInTheDocument()
    // empty state offers a next step
    expect(
      screen.getByRole('button', { name: 'Open scenarios' }),
    ).toBeInTheDocument()
    // error state carries a reference id
    expect(screen.getByText('LW-4F2A19')).toBeInTheDocument()
    // loading placeholders are announced
    expect(
      screen
        .getAllByRole('status')
        .some((el) => /loading/i.test(el.textContent ?? '')),
    ).toBe(true)
  })

  // The gallery renders every component and state: one axe pass takes ~5 s on its own.
  it('has no axe violations', { timeout: 20_000 }, async () => {
    const { container } = render(<App />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
