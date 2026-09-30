import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { Button } from './button'

describe('Button', () => {
  it('renders as a button with its text as the accessible name', () => {
    render(<Button>Send offers</Button>)
    expect(
      screen.getByRole('button', { name: 'Send offers' }),
    ).toBeInTheDocument()
  })

  it('defaults type to "button" so it never submits a form by accident', () => {
    render(<Button>Cancel</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
  })

  it('sets aria-busy and disables interaction while loading', async () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        Publishing
      </Button>,
    )
    const btn = screen.getByRole('button')
    expect(btn).toHaveAttribute('aria-busy', 'true')
    expect(btn).toBeDisabled()
    await userEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('warns in dev when an icon-only button has no accessible name', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(
      <Button size="icon">
        <span aria-hidden>×</span>
      </Button>,
    )
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('has no axe violations', async () => {
    const { container } = render(<Button variant="primary">Publish plan</Button>)
    expect(await axe(container)).toHaveNoViolations()
  })
})
