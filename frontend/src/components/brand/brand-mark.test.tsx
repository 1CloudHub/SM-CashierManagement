import { render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { I18nProvider } from '@/i18n'
import { BrandMark } from './brand-mark'

function renderMark(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>)
}

describe('BrandMark', () => {
  it('exposes the full lockup as one image named with the endorsement', () => {
    renderMark(<BrandMark />)
    expect(screen.getByRole('img', { name: 'LaneWise by SM Retail' })).toBeInTheDocument()
  })

  it('mark-only lockup is a square tile named with the product name', () => {
    renderMark(<BrandMark lockup="mark" />)
    const img = screen.getByRole('img', { name: 'LaneWise' })
    expect(img).toHaveAttribute('viewBox', '0 0 64 64')
    expect(img.querySelectorAll('text')).toHaveLength(0)
  })

  it('colours only through brand-role utilities (no raw fills)', () => {
    const { container } = renderMark(
      <>
        <BrandMark />
        <BrandMark variant="reversed" />
      </>,
    )
    const painted = container.querySelectorAll('rect, text')
    expect(painted.length).toBeGreaterThan(0)
    for (const el of painted) {
      expect(el.getAttribute('fill')).toBeNull()
      expect(el.getAttribute('class')).toMatch(
        /^fill-(brand|on-brand|brand-endorsement|appbar|on-appbar)$/,
      )
    }
  })

  it('reversed variant flips tile and text to the on-app-bar colour', () => {
    const { container } = renderMark(<BrandMark variant="reversed" />)
    const [tile, ...lanes] = container.querySelectorAll('rect')
    expect(tile).toHaveClass('fill-on-appbar')
    expect(lanes.slice(0, 3).every((l) => l.classList.contains('fill-appbar'))).toBe(true)
    for (const text of container.querySelectorAll('text')) {
      expect(text).toHaveClass('fill-on-appbar')
    }
  })

  it('has no axe violations', async () => {
    const { container } = renderMark(<BrandMark />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
