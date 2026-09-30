import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { SideNav, type NavSection } from './side-nav'
import { TopBar } from './top-bar'

const NAV: NavSection[] = [
  { items: [{ label: 'Home', href: '#home', icon: '⌂', current: true }] },
  {
    title: 'Plan',
    items: [{ label: 'Network view', href: '#net', icon: 'N' }],
  },
]

describe('SideNav', () => {
  it('is a labelled navigation landmark with the current item marked', () => {
    render(<SideNav sections={NAV} />)
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(nav).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('renders section headings and role-filtered items given to it', () => {
    render(<SideNav sections={NAV} />)
    expect(screen.getByRole('heading', { name: 'Plan' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Network view' })).toBeInTheDocument()
  })
})

describe('TopBar', () => {
  it('is a banner with an accessible menu toggle wired to the nav', async () => {
    const onToggle = vi.fn()
    render(<TopBar onMenuToggle={onToggle} menuExpanded={false} />)
    expect(screen.getByRole('banner')).toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Open navigation' })
    expect(toggle).toHaveAttribute('aria-controls', 'sidenav')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('has no axe violations with a search slot', async () => {
    const { container } = render(
      <TopBar
        onMenuToggle={() => {}}
        search={
          <form role="search">
            <label htmlFor="q" className="sr-only">
              Search
            </label>
            <input id="q" type="search" />
          </form>
        }
        onSearchToggle={() => {}}
      />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})
