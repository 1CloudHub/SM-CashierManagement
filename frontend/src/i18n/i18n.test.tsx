import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { I18nProvider, useI18n } from './context'
import { LanguageSwitcher } from './language-switcher'
import { PESO_SIGN } from './format'
import { Currency, Num } from '@/components/ui/currency'

function Probe() {
  const { t, locale } = useI18n()
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="save">{t('action.save')}</span>
    </div>
  )
}

describe('I18nProvider + useI18n', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.lang = ''
  })

  it('defaults to English and exposes t()', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    )
    expect(screen.getByTestId('locale')).toHaveTextContent('en')
    expect(screen.getByTestId('save')).toHaveTextContent('Save')
  })

  it('honours an initialLocale', () => {
    render(
      <I18nProvider initialLocale="fil">
        <Probe />
      </I18nProvider>,
    )
    expect(screen.getByTestId('save')).toHaveTextContent('I-save')
  })

  it('reflects the active locale on <html lang> (BCP-47 tag)', () => {
    render(
      <I18nProvider initialLocale="fil">
        <Probe />
      </I18nProvider>,
    )
    expect(document.documentElement.lang).toBe('fil-PH')
  })

  it('reads a persisted locale from localStorage', () => {
    window.localStorage.setItem('lw.locale', 'fil')
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    )
    expect(screen.getByTestId('save')).toHaveTextContent('I-save')
  })

  it('throws when useI18n is used outside a provider', () => {
    // Silence the expected React error boundary console noise.
    const spy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    expect(() => render(<Probe />)).toThrow(/within an I18nProvider/)
    spy.mockRestore()
  })
})

describe('LanguageSwitcher (req. 23.1)', () => {
  beforeEach(() => window.localStorage.clear())

  it('is a labelled select and switches + persists the locale', async () => {
    render(
      <I18nProvider>
        <LanguageSwitcher />
        <Probe />
      </I18nProvider>,
    )
    const select = screen.getByRole('combobox', { name: /language/i })
    expect(screen.getByTestId('save')).toHaveTextContent('Save')

    await userEvent.selectOptions(select, 'fil')

    expect(screen.getByTestId('save')).toHaveTextContent('I-save')
    expect(window.localStorage.getItem('lw.locale')).toBe('fil')
    expect(document.documentElement.lang).toBe('fil-PH')
  })

  it('full variant shows a visible label and endonyms', () => {
    render(
      <I18nProvider>
        <LanguageSwitcher variant="full" />
      </I18nProvider>,
    )
    const select = screen.getByRole('combobox', { name: /language/i })
    expect(select).toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: 'English' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: 'Filipino' }),
    ).toBeInTheDocument()
  })

  it('has no axe violations', async () => {
    const { container } = render(
      <I18nProvider>
        <LanguageSwitcher />
      </I18nProvider>,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('Currency / Num (SG-002)', () => {
  it('renders ₱ with the Unicode peso sign and tabular figures', () => {
    render(
      <I18nProvider>
        <Currency value={13_600_000} compact />
      </I18nProvider>,
    )
    const el = screen.getByText(new RegExp(PESO_SIGN))
    expect(el).toHaveClass('lw-numeric')
  })

  it('renders a locale number tabularly', () => {
    render(
      <I18nProvider>
        <Num value={3688} />
      </I18nProvider>,
    )
    expect(screen.getByText('3,688')).toHaveClass('lw-numeric')
  })

  it('re-renders currency in the active locale after a switch', async () => {
    render(
      <I18nProvider>
        <LanguageSwitcher />
        <Currency value={1000} />
      </I18nProvider>,
    )
    // Peso sign present in English.
    expect(screen.getByText(new RegExp(PESO_SIGN))).toBeInTheDocument()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /language/i }),
      'fil',
    )
    // Still present (formatter switched locale, glyph normalised).
    expect(screen.getByText(new RegExp(PESO_SIGN))).toBeInTheDocument()
  })
})
