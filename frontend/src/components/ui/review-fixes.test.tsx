import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { I18nProvider } from '@/i18n'
import { Button } from './button'
import { Checkbox, Radio } from './checkbox'
import { Dialog, DialogContent, DialogTitle } from './dialog'
import { Field } from './field'
import { Input } from './input'
import { ToastProvider, useToast } from './toast'

function ToastOnMount() {
  const { toast } = useToast()
  return <Button onClick={() => toast({ title: 'Saved' })}>Save</Button>
}

describe('Toast timing (WCAG 2.2.1)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('pauses auto-dismiss while hovered and resumes with the time left', () => {
    render(
      <ToastProvider>
        <ToastOnMount />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const toast = screen.getByRole('status')
    act(() => vi.advanceTimersByTime(3000))
    fireEvent.pointerEnter(toast)
    act(() => vi.advanceTimersByTime(10_000))
    expect(screen.getByRole('status')).toBeInTheDocument()
    fireEvent.pointerLeave(toast)
    act(() => vi.advanceTimersByTime(1900))
    expect(screen.getByRole('status')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(200))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('pauses while focus is inside the toast', () => {
    render(
      <ToastProvider>
        <ToastOnMount />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' })
    // Full 44px target: no size overrides on the dismiss control.
    expect(dismiss.className).not.toMatch(/\bsize-8\b|min-h-0|min-w-0/)
    fireEvent.focus(dismiss)
    act(() => vi.advanceTimersByTime(10_000))
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})

describe('Kit copy comes from i18n', () => {
  it('names the dialog close button and the toast region in Filipino', () => {
    window.localStorage.setItem('lw.locale', 'fil')
    render(
      <I18nProvider>
        <ToastProvider>
          <Dialog open>
            <DialogContent>
              <DialogTitle>Pamagat</DialogTitle>
            </DialogContent>
          </Dialog>
        </ToastProvider>
      </I18nProvider>,
    )
    expect(screen.getByRole('button', { name: 'Isara' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Mga abiso', hidden: true })).toBeInTheDocument()
    window.localStorage.removeItem('lw.locale')
  })

  it('falls back to English outside a provider', () => {
    render(<Button loading>Save</Button>)
    expect(screen.getByText('Working…')).toHaveClass('sr-only')
  })
})

describe('Dialog sizing', () => {
  it('caps a centred dialog at the viewport and scrolls inside it', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Long form</DialogTitle>
        </DialogContent>
      </Dialog>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveClass('max-h-[calc(100dvh-2rem)]', 'overflow-y-auto')
  })
})

describe('Field error', () => {
  it('pairs the message with an aria-hidden icon', () => {
    render(<Field label="Name" error="Enter a name">{(a) => <Input {...a} />}</Field>)
    const message = screen.getByText('Enter a name').parentElement
    expect(message?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('Disabled buttons', () => {
  it('use token colours, keep pointer events and show not-allowed', () => {
    render(<Button disabled>Publish</Button>)
    const button = screen.getByRole('button', { name: 'Publish' })
    expect(button.className).not.toMatch(/opacity-|pointer-events-none/)
    expect(button).toHaveClass('disabled:cursor-not-allowed', 'disabled:text-text-muted')
  })
})

describe('Checkbox and Radio', () => {
  it('are labelled native controls inside a 44px label target', async () => {
    const onChange = vi.fn()
    const { container } = render(
      <fieldset>
        <legend>Options</legend>
        <Checkbox label="Stale only" onChange={onChange} />
        <Checkbox label="Select row" hideLabel />
        <Radio name="c" value="a" label="By department" defaultChecked />
        <Radio name="c" value="b" label="By role" />
      </fieldset>,
    )
    const box = screen.getByRole('checkbox', { name: 'Stale only' })
    expect(box.closest('label')).toHaveClass('min-h-tap', 'min-w-tap')
    expect(box).toHaveClass('accent-primary')
    fireEvent.click(screen.getByText('Stale only'))
    expect(onChange).toHaveBeenCalledOnce()
    expect(screen.getByRole('checkbox', { name: 'Select row' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'By department' })).toBeChecked()
    expect(await axe(container)).toHaveNoViolations()
  })

  it('sets the indeterminate state', () => {
    render(<Checkbox label="Select all" indeterminate />)
    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Select all' })
    expect(box.indeterminate).toBe(true)
  })
})
