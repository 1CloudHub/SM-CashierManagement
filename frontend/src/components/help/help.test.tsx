import { useEffect, useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { I18nProvider, useI18n } from '@/i18n'
import { useShortcut } from '@/lib/keyboard'
import { HelpProvider } from './help-provider'
import { HelpButton } from './help-button'
import { InfoPopover } from './info-popover'

/**
 * Tests for the Help and shortcuts screen (SCR-091) and the field-level info
 * popover (task 1.9). Confirms discoverability (`?` and the Help button both
 * open it), that the reference lists the currently-registered shortcuts, that
 * all copy is localised, and that the info popover is keyboard/SR accessible
 * and dismissable (never tooltip-only).
 */

function Providers({
  children,
  onFocusSearch,
}: {
  children?: React.ReactNode
  onFocusSearch?: () => void
}) {
  return (
    <I18nProvider>
      <HelpProvider onFocusSearch={onFocusSearch ?? vi.fn()} onNavigate={vi.fn()}>
        <HelpButton />
        {children}
      </HelpProvider>
    </I18nProvider>
  )
}

/** Flip the locale once on mount so a subtree renders Filipino copy. */
function SetLocale({ locale }: { locale: 'en' | 'fil' }) {
  const { setLocale } = useI18n()
  const done = useRef(false)
  useEffect(() => {
    if (!done.current) {
      done.current = true
      setLocale(locale)
    }
  }, [locale, setLocale])
  return null
}

describe('Help and shortcuts (SCR-091)', () => {
  it('opens with the ? shortcut', async () => {
    const user = userEvent.setup()
    render(<Providers />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.keyboard('?')
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleName(/help and shortcuts/i)
  })

  it('opens from the Help button (pointer path)', async () => {
    const user = userEvent.setup()
    render(<Providers />)
    await user.click(screen.getByRole('button', { name: /help and shortcuts/i }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('lists the global scheme and any screen shortcuts in the reference', async () => {
    const user = userEvent.setup()
    function ScreenShortcut() {
      useShortcut({
        id: 'roster.open',
        keys: ['Enter'],
        groupId: 'shortcut.group.roster',
        descriptionId: 'shortcut.roster.open',
        run: vi.fn(),
      })
      return null
    }
    render(
      <Providers>
        <ScreenShortcut />
      </Providers>,
    )
    await user.keyboard('?')
    await screen.findByRole('dialog')
    // Global: search (registered because onFocusSearch was provided).
    expect(screen.getByText(/search stores, departments/i)).toBeInTheDocument()
    // Global: help itself is always listed.
    expect(screen.getByText(/open this shortcut reference/i)).toBeInTheDocument()
    // Navigation group.
    expect(screen.getByText(/go to the weekly roster/i)).toBeInTheDocument()
    // The screen-scoped shortcut.
    expect(screen.getByText(/open the focused shift/i)).toBeInTheDocument()
  })

  it('localises the title into Filipino when the locale is fil', async () => {
    const user = userEvent.setup()
    render(
      <I18nProvider>
        <HelpProvider onNavigate={vi.fn()}>
          <SetLocale locale="fil" />
          <HelpButton />
        </HelpProvider>
      </I18nProvider>,
    )
    await user.keyboard('?')
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleName(/tulong at mga shortcut/i)
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    render(<Providers />)
    await user.keyboard('?')
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
  })

  it('has no axe violations when open', async () => {
    const user = userEvent.setup()
    const { container } = render(<Providers />)
    await user.keyboard('?')
    await screen.findByRole('dialog')
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('InfoPopover (field-level help, never tooltip-only)', () => {
  function PopoverHarness() {
    return (
      <I18nProvider>
        <InfoPopover title="How it's calculated">
          Uses the scenario snapshot and rules.
        </InfoPopover>
      </I18nProvider>
    )
  }

  it('toggles content that is keyboard + SR accessible', async () => {
    const user = userEvent.setup()
    render(<PopoverHarness />)
    const trigger = screen.getByRole('button', { name: /more information/i })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/uses the scenario snapshot/i)).toBeInTheDocument()
  })

  it('closes on Escape and restores focus to the trigger', async () => {
    const user = userEvent.setup()
    render(<PopoverHarness />)
    const trigger = screen.getByRole('button', { name: /more information/i })
    await user.click(trigger)
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(
        screen.queryByText(/uses the scenario snapshot/i),
      ).not.toBeInTheDocument(),
    )
    expect(trigger).toHaveFocus()
  })

  it('closes on outside pointer interaction', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <PopoverHarness />
        <button>outside</button>
      </div>,
    )
    await user.click(screen.getByRole('button', { name: /more information/i }))
    expect(screen.getByText(/uses the scenario snapshot/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'outside' }))
    await waitFor(() =>
      expect(
        screen.queryByText(/uses the scenario snapshot/i),
      ).not.toBeInTheDocument(),
    )
  })

  it('has no axe violations when open', async () => {
    const user = userEvent.setup()
    const { container } = render(<PopoverHarness />)
    await user.click(screen.getByRole('button', { name: /more information/i }))
    expect(await axe(container)).toHaveNoViolations()
  })
})
