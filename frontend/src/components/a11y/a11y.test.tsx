import { useState } from 'react'
import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { SkipLink } from './skip-link'
import { AnnouncerProvider, useAnnouncer, useAnnounce } from './announcer'
import { useRouteFocus, useRestoreFocus } from './use-route-focus'
import {
  cellActionLabel,
  describedBy,
  menuTrigger,
  timelineShiftLabel,
} from './labelling'
import { AppShell } from '@/components/layout/app-shell'
import type { NavSection } from '@/components/shell/side-nav'

/**
 * Tests for the task 1.7 accessibility layer: skip link, live-region
 * announcer, focus management and the labelling helpers (UX-001, UX-004,
 * NFR-A11Y-001). Full WCAG conformance still needs manual assistive-tech
 * testing; these lock in the structure and behaviour.
 */

describe('SkipLink', () => {
  it('is a link pointing at the main landmark', () => {
    render(<SkipLink />)
    const link = screen.getByRole('link', { name: 'Skip to main content' })
    expect(link).toHaveAttribute('href', '#main')
  })

  it('targets a custom id and label', () => {
    render(<SkipLink targetId="content">Jump to content</SkipLink>)
    const link = screen.getByRole('link', { name: 'Jump to content' })
    expect(link).toHaveAttribute('href', '#content')
  })

  it('has a focusable main target it can move focus to', () => {
    render(
      <div>
        <SkipLink />
        <main id="main" tabIndex={-1}>
          <h1>Content</h1>
        </main>
      </div>,
    )
    // jsdom doesn't follow in-page anchors, so assert the contract the
    // AppShell relies on: the target landmark can hold focus.
    const main = screen.getByRole('main')
    main.focus()
    expect(main).toHaveFocus()
  })

  it('has no axe violations', async () => {
    const { container } = render(
      <div>
        <SkipLink />
        <main id="main" tabIndex={-1}>
          <h1>Content</h1>
        </main>
      </div>,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('Announcer', () => {
  function Trigger() {
    const { announce } = useAnnouncer()
    return (
      <div>
        <button onClick={() => announce('Draft saved')}>polite</button>
        <button onClick={() => announce('Server error', 'assertive')}>
          assertive
        </button>
      </div>
    )
  }

  it('announces polite messages in the status region', async () => {
    const user = userEvent.setup()
    render(
      <AnnouncerProvider>
        <Trigger />
      </AnnouncerProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'polite' }))
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Draft saved')
    expect(status).toHaveAttribute('aria-live', 'polite')
  })

  it('announces errors in the assertive alert region', async () => {
    const user = userEvent.setup()
    render(
      <AnnouncerProvider>
        <Trigger />
      </AnnouncerProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'assertive' }))
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Server error')
    expect(alert).toHaveAttribute('aria-live', 'assertive')
  })

  it('useAnnounce announces a derived value when it changes, not on mount', () => {
    function Derived({ count }: { count: number }) {
      useAnnounce(count > 0 ? `${count} results` : undefined)
      return null
    }
    const { rerender } = render(
      <AnnouncerProvider>
        <Derived count={0} />
      </AnnouncerProvider>,
    )
    // Nothing announced initially.
    expect(screen.getByRole('status')).toHaveTextContent('')
    rerender(
      <AnnouncerProvider>
        <Derived count={3} />
      </AnnouncerProvider>,
    )
    expect(screen.getByRole('status')).toHaveTextContent('3 results')
  })

  it('throws if useAnnouncer is used without a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Bare() {
      useAnnouncer()
      return null
    }
    expect(() => render(<Bare />)).toThrow(/AnnouncerProvider/)
    spy.mockRestore()
  })
})

describe('useRouteFocus', () => {
  function Harness({ route }: { route: string }) {
    useRouteFocus(route)
    return (
      <div>
        <a href="#somewhere">a link</a>
        <main id="main" tabIndex={-1}>
          content
        </main>
      </div>
    )
  }

  it('moves focus to #main on route change, but not on first render', async () => {
    const { rerender } = render(<Harness route="/home" />)
    // First render should not steal focus.
    expect(screen.getByRole('main')).not.toHaveFocus()

    await act(async () => {
      rerender(<Harness route="/roster" />)
    })
    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus())
  })
})

describe('useRestoreFocus', () => {
  function Harness() {
    const [open, setOpen] = useState(false)
    useRestoreFocus(open)
    return (
      <div>
        <button onClick={() => setOpen(true)}>open</button>
        {open && <button onClick={() => setOpen(false)}>close</button>}
      </div>
    )
  }

  it('returns focus to the trigger when the surface closes', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const openBtn = screen.getByRole('button', { name: 'open' })
    openBtn.focus()
    await user.click(openBtn)
    await user.click(screen.getByRole('button', { name: 'close' }))
    await waitFor(() => expect(openBtn).toHaveFocus())
  })
})

describe('labelling helpers', () => {
  it('describedBy merges, de-dupes and drops empties', () => {
    expect(describedBy('a', undefined, 'b', null, false)).toBe('a b')
    expect(describedBy('a a', 'b')).toBe('a b')
    expect(describedBy(undefined, null)).toBeUndefined()
  })

  it('menuTrigger wires haspopup/expanded/controls to the surface id', () => {
    const menu = menuTrigger('user-menu', true)
    expect(menu.id).toBe('user-menu')
    expect(menu.triggerProps).toEqual({
      'aria-haspopup': 'menu',
      'aria-expanded': true,
      'aria-controls': 'user-menu',
    })
  })

  it('cellActionLabel builds a descriptive name, not just an icon', () => {
    expect(cellActionLabel('Mark unavailable', 'PT-02', 'Sat Dec 19')).toBe(
      'Mark unavailable — PT-02, Sat Dec 19',
    )
    expect(cellActionLabel('Edit shift', 'Lane 3')).toBe('Edit shift — Lane 3')
  })

  it('timelineShiftLabel joins staff, time and lane', () => {
    expect(timelineShiftLabel('PT-02', '09:00–13:00', 'Lane 3')).toBe(
      'PT-02, 09:00–13:00, Lane 3',
    )
    expect(timelineShiftLabel('FT-01', '13:00–21:00')).toBe(
      'FT-01, 13:00–21:00',
    )
  })
})

describe('AppShell accessibility wiring (task 1.7)', () => {
  const NAV: NavSection[] = [
    { items: [{ label: 'Home', href: '#home', icon: '⌂', current: true }] },
  ]

  it('renders the skip link first, targeting the focusable #main landmark', () => {
    render(
      <AppShell nav={NAV}>
        <h1>Network view</h1>
      </AppShell>,
    )
    const skip = screen.getByRole('link', { name: 'Skip to main content' })
    expect(skip).toHaveAttribute('href', '#main')

    const main = screen.getByRole('main', { name: 'Main content' })
    expect(main).toHaveAttribute('id', 'main')
    // Focusable target so the skip link / route focus can land here.
    expect(main).toHaveAttribute('tabindex', '-1')
    main.focus()
    expect(main).toHaveFocus()
  })

  it('has no axe violations with the skip link + landmarks', async () => {
    const { container } = render(
      <AppShell nav={NAV}>
        <h1>Network view</h1>
      </AppShell>,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})
