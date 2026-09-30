import { describe, expect, it } from 'vitest'
import {
  PESO_SIGN,
  formatCurrency,
  formatCurrencyCompact,
  formatDate,
  formatNumber,
  formatPercent,
} from './format'

describe('formatCurrency (SG-002 — ₱ / U+20B1)', () => {
  it('renders the Unicode peso sign, never a "P" or "PHP"', () => {
    const out = formatCurrency(13_600_000, 'en')
    expect(out.startsWith(PESO_SIGN)).toBe(true)
    expect(PESO_SIGN).toBe('\u20B1')
    expect(out).not.toMatch(/PHP/)
    // No bare ASCII "P" acting as the currency symbol.
    expect(out).not.toMatch(/^P\d/)
  })

  it('groups thousands and shows centavos by default', () => {
    const out = formatCurrency(1234.5, 'en')
    expect(out).toContain('1,234')
    expect(out).toMatch(/\.50$/)
  })

  it('respects maximumFractionDigits: 0 for whole-peso figures', () => {
    const out = formatCurrency(13_600_000, 'en', { maximumFractionDigits: 0 })
    expect(out).toBe(`${PESO_SIGN}13,600,000`)
  })

  it('formats compactly for KPIs', () => {
    const out = formatCurrencyCompact(13_600_000, 'en')
    expect(out).toContain(PESO_SIGN)
    expect(out).toMatch(/13\.6M/i)
  })

  it('produces the peso sign for the Filipino locale too', () => {
    const out = formatCurrency(1000, 'fil')
    expect(out).toContain(PESO_SIGN)
  })
})

describe('formatNumber / formatPercent', () => {
  it('groups numbers for the locale', () => {
    expect(formatNumber(3688, 'en')).toBe('3,688')
  })

  it('renders a percent from a ratio', () => {
    expect(formatPercent(0.9, 'en')).toBe('90%')
  })
})

describe('formatDate', () => {
  it('formats an ISO date for the locale (medium by default)', () => {
    const out = formatDate('2026-12-19T00:00:00Z', 'en', {
      dateStyle: 'medium',
      timeZone: 'UTC',
    })
    // en-PH medium date includes the year and Dec; exact punctuation varies by
    // ICU version, so assert the salient tokens.
    expect(out).toMatch(/2026/)
    expect(out).toMatch(/Dec/i)
    expect(out).toMatch(/19/)
  })
})
