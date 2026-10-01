import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { ThemeToggle } from './theme-toggle'
import { TopBar } from './top-bar'
import { UserMenu } from './user-menu'

afterEach(() => {
  window.localStorage.removeItem('lw.theme')
  delete document.documentElement.dataset.theme
})

describe('ThemeToggle', () => {
  it('sets data-theme on <html> and persists the choice', async () => {
    render(<ThemeToggle />)
    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem('lw.theme')).toBe('dark')
    await userEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }))
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})

describe('UserMenu', () => {
  it('discloses the account, profile, help and sign out; Esc closes it', async () => {
    const onSignOut = vi.fn()
    render(<UserMenu name="Ana Cruz" email="ana@smretail.com" onSignOut={onSignOut} />)
    const trigger = screen.getByRole('button', { name: 'Account menu' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('ana@smretail.com')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile')
    expect(screen.getByRole('link', { name: 'Help and shortcuts' })).toHaveAttribute('href', '/help')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('link', { name: 'Profile' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(onSignOut).toHaveBeenCalledOnce()
  })

  it('has no axe violations when open', async () => {
    const { container } = render(<UserMenu email="ana@smretail.com" onSignOut={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('TopBar on narrow screens', () => {
  it('keeps the byline in the brand name but visually hidden below tablet', () => {
    render(<TopBar />)
    const byline = screen.getByText('by SM Retail')
    expect(byline).toHaveClass('sr-only', 'tablet:not-sr-only')
    expect(screen.getByRole('banner')).toHaveClass('min-w-0')
  })

  it('renders the search toggle without an inline search (mounted once per breakpoint)', () => {
    render(<TopBar onSearchToggle={() => {}} />)
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
    expect(screen.queryByRole('search')).not.toBeInTheDocument()
  })
})
