import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KeyboardShortcutsProvider } from './keyboard-context'
import { useKeyboardShortcuts } from './keyboard-store'
import { useShortcut, useShortcuts } from './use-shortcut'
import type { Shortcut } from './keys'

/**
 * Behavioural tests for the shortcut engine + registration hooks (task 1.9).
 * These are the design rules that must not regress:
 *   - plain keys are disabled while typing, ⌘/Ctrl combos still fire,
 *   - `g`+key sequences complete (and a stray leader clears),
 *   - shortcuts unregister on unmount (scope to their screen),
 *   - the registry is exposed to the reference.
 */

function ShortcutHarness({ shortcut }: { shortcut: Shortcut }) {
  useShortcut(shortcut)
  return (
    <div>
      <input aria-label="a field" />
      <button>a button</button>
    </div>
  )
}

function renderWithProvider(ui: React.ReactNode) {
  return render(<KeyboardShortcutsProvider>{ui}</KeyboardShortcutsProvider>)
}

describe('single-key shortcuts', () => {
  it('fires a plain-key shortcut when not typing', async () => {
    const user = userEvent.setup()
    const run = vi.fn()
    renderWithProvider(
      <ShortcutHarness
        shortcut={{
          id: 's.help',
          keys: ['?'],
          groupId: 'g',
          descriptionId: 'd',
          run,
        }}
      />,
    )
    await user.keyboard('?')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire a plain-key shortcut while typing in an input', async () => {
    const user = userEvent.setup()
    const run = vi.fn()
    renderWithProvider(
      <ShortcutHarness
        shortcut={{ id: 's.slash', keys: ['/'], groupId: 'g', descriptionId: 'd', run }}
      />,
    )
    await user.click(screen.getByLabelText('a field'))
    await user.keyboard('/')
    expect(run).not.toHaveBeenCalled()
  })

  it('DOES fire a ⌘/Ctrl combo even while typing (command palette)', async () => {
    const user = userEvent.setup()
    const run = vi.fn()
    renderWithProvider(
      <ShortcutHarness
        shortcut={{
          id: 's.cmdk',
          keys: ['mod+k'],
          groupId: 'g',
          descriptionId: 'd',
          run,
        }}
      />,
    )
    await user.click(screen.getByLabelText('a field'))
    // On the jsdom (non-Apple) platform, mod resolves to Ctrl.
    await user.keyboard('{Control>}k{/Control}')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('fires an allowInInput shortcut while typing (e.g. Esc)', async () => {
    const user = userEvent.setup()
    const run = vi.fn()
    renderWithProvider(
      <ShortcutHarness
        shortcut={{
          id: 's.esc',
          keys: ['Escape'],
          groupId: 'g',
          descriptionId: 'd',
          allowInInput: true,
          run,
        }}
      />,
    )
    await user.click(screen.getByLabelText('a field'))
    await user.keyboard('{Escape}')
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('sequence shortcuts (g + key)', () => {
  it('completes a g then h sequence', async () => {
    const user = userEvent.setup()
    const run = vi.fn()
    renderWithProvider(
      <ShortcutHarness
        shortcut={{
          id: 'nav.home',
          sequence: ['g', 'h'],
          groupId: 'g',
          descriptionId: 'd',
          run,
        }}
      />,
    )
    await user.keyboard('gh')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('does not fire on a non-matching second key', async () => {
    const user = userEvent.setup()
    const run = vi.fn()
    renderWithProvider(
      <ShortcutHarness
        shortcut={{
          id: 'nav.home',
          sequence: ['g', 'h'],
          groupId: 'g',
          descriptionId: 'd',
          run,
        }}
      />,
    )
    await user.keyboard('gx')
    expect(run).not.toHaveBeenCalled()
  })

  it('does not arm a sequence while typing', async () => {
    const user = userEvent.setup()
    const run = vi.fn()
    renderWithProvider(
      <ShortcutHarness
        shortcut={{
          id: 'nav.home',
          sequence: ['g', 'h'],
          groupId: 'g',
          descriptionId: 'd',
          run,
        }}
      />,
    )
    await user.click(screen.getByLabelText('a field'))
    await user.keyboard('gh')
    expect(run).not.toHaveBeenCalled()
  })
})

describe('registration lifecycle', () => {
  function Registry() {
    const { shortcuts } = useKeyboardShortcuts()
    return <div data-testid="count">{shortcuts.length}</div>
  }

  function Screen({ mounted }: { mounted: boolean }) {
    return (
      <>
        <Registry />
        {mounted && (
          <ShortcutHarness
            shortcut={{
              id: 'screen.only',
              keys: ['x'],
              groupId: 'g',
              descriptionId: 'd',
              run: vi.fn(),
            }}
          />
        )}
      </>
    )
  }

  it('registers on mount and unregisters on unmount (screen scope)', () => {
    const { rerender } = render(
      <KeyboardShortcutsProvider>
        <Screen mounted />
      </KeyboardShortcutsProvider>,
    )
    expect(screen.getByTestId('count')).toHaveTextContent('1')

    rerender(
      <KeyboardShortcutsProvider>
        <Screen mounted={false} />
      </KeyboardShortcutsProvider>,
    )
    expect(screen.getByTestId('count')).toHaveTextContent('0')
  })

  it('does not register a disabled shortcut', () => {
    render(
      <KeyboardShortcutsProvider>
        <Registry />
        <DisabledHarness />
      </KeyboardShortcutsProvider>,
    )
    expect(screen.getByTestId('count')).toHaveTextContent('0')
  })
})

function DisabledHarness() {
  useShortcut({
    id: 'disabled.one',
    keys: ['y'],
    groupId: 'g',
    descriptionId: 'd',
    enabled: false,
    run: vi.fn(),
  })
  return null
}

describe('useShortcuts (list)', () => {
  it('registers several and fires the right handler', async () => {
    const user = userEvent.setup()
    const a = vi.fn()
    const b = vi.fn()
    function ManyHarness() {
      useShortcuts([
        { id: 'a', keys: ['a'], groupId: 'g', descriptionId: 'd', run: a },
        { id: 'b', keys: ['b'], groupId: 'g', descriptionId: 'd', run: b },
      ])
      return null
    }
    renderWithProvider(<ManyHarness />)
    await user.keyboard('a')
    await user.keyboard('b')
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })
})

describe('help open state', () => {
  // Drive the state through the engine's own API via a button, so the test
  // never captures the context during render (which the react-hooks lint
  // forbids). The button + text mirror how the HelpButton uses the engine.
  function HelpToggle() {
    const { helpOpen, setHelpOpen } = useKeyboardShortcuts()
    return (
      <div>
        <span data-testid="help">{String(helpOpen)}</span>
        <button onClick={() => setHelpOpen(true)}>open help</button>
      </div>
    )
  }

  it('is exposed and togglable via the engine', async () => {
    const user = userEvent.setup()
    render(
      <KeyboardShortcutsProvider>
        <HelpToggle />
      </KeyboardShortcutsProvider>,
    )
    expect(screen.getByTestId('help')).toHaveTextContent('false')
    await user.click(screen.getByRole('button', { name: 'open help' }))
    expect(screen.getByTestId('help')).toHaveTextContent('true')
  })
})
