import { COST_LEVELS, ROLE_CODES, costLevelsFor, type CostLevel, type RoleCode } from '@lanewise/shared'
import { render, screen } from '@testing-library/react'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { axe } from 'vitest-axe'
import { ActiveRoleProvider } from '@/app/active-role'
import { I18nProvider } from '@/i18n'
import { CostValue } from './cost-value'

function renderCost(role: RoleCode, level: CostLevel, value: number | null | undefined, locale: 'en' | 'fil' = 'en') {
  return render(
    <I18nProvider initialLocale={locale}>
      <ActiveRoleProvider demo={false} assignedRoles={[role]}>
        <p>
          <CostValue value={value} level={level} compact />
        </p>
      </ActiveRoleProvider>
    </I18nProvider>,
  )
}

describe('<CostValue> (task 21, requirement 25)', () => {
  it('property: shows ₱ iff the role may see the level and the API sent the figure', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ROLE_CODES),
        fc.constantFrom(...COST_LEVELS),
        fc.option(fc.integer({ min: 1, max: 20_000_000 }), { nil: undefined }),
        (role, level, value) => {
          const { container, unmount } = renderCost(role, level, value)
          const shown = costLevelsFor(role).includes(level) && value !== undefined
          if (shown) expect(container).toHaveTextContent('₱')
          else {
            expect(container).not.toHaveTextContent('₱')
            expect(container).toHaveTextContent('Hidden for your role')
          }
          unmount()
        },
      ),
      { numRuns: 60 },
    )
  })

  it('never renders a figure for Staff, even one that reached the client', () => {
    renderCost('STF', 'individual', 700)
    expect(screen.queryByText(/₱/)).toBeNull()
    expect(screen.getByText('Hidden for your role')).toBeInTheDocument()
  })

  it('hides network cost from a Store Manager but shows own-store cost', () => {
    const { unmount } = renderCost('STM', 'network', 13_600_000)
    expect(screen.getByText('Hidden for your role')).toBeInTheDocument()
    unmount()
    renderCost('STM', 'store', 24_700)
    expect(screen.getByText(/₱/)).toBeInTheDocument()
  })

  it('renders a missing figure (null) as an em dash, not as hidden', () => {
    const { container } = renderCost('PLN', 'network', null)
    expect(container).toHaveTextContent('—')
    expect(screen.getByText('No figure')).toHaveClass('sr-only')
    expect(screen.queryByText('Hidden for your role')).toBeNull()
  })

  it('still shows hidden for a null figure the role may not see', () => {
    renderCost('STF', 'network', null)
    expect(screen.getByText('Hidden for your role')).toBeInTheDocument()
  })

  it('localises the hidden state (fil) and has no axe violations', async () => {
    const { container } = renderCost('RST', 'store', undefined, 'fil')
    expect(screen.getByText('Nakatago para sa iyong tungkulin')).toBeInTheDocument()
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(await axe(container)).toHaveNoViolations()
  })
})
