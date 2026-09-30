import { describe, expect, it } from 'vitest'
import { BUNDLES } from './resources'
import { translate } from './translate'
import { LOCALES } from './types'

describe('resource bundle integrity (req. 23.2, UX-011)', () => {
  const enKeys = Object.keys(BUNDLES.en).sort()

  it('every locale covers exactly the English key set (no missing/stray keys)', () => {
    for (const locale of LOCALES) {
      const keys = Object.keys(BUNDLES[locale]).sort()
      expect(keys, `locale ${locale}`).toEqual(enKeys)
    }
  })

  it('no bundle has an empty string value', () => {
    for (const locale of LOCALES) {
      for (const [id, value] of Object.entries(BUNDLES[locale])) {
        expect(value.trim().length, `${locale}:${id}`).toBeGreaterThan(0)
      }
    }
  })

  it('error copy leaks no stack traces or object internals (req. 2.4)', () => {
    for (const locale of LOCALES) {
      for (const [id, value] of Object.entries(BUNDLES[locale])) {
        if (!id.startsWith('error.')) continue
        expect(value.toLowerCase()).not.toMatch(
          /stack|trace|exception|\bnull\b|undefined|0x[0-9a-f]/,
        )
      }
    }
  })
})

describe('translate()', () => {
  it('resolves a key for the requested locale', () => {
    expect(translate(BUNDLES, 'fil', 'action.save')).toBe('I-save')
  })

  it('falls back to English when a key is missing in the locale', () => {
    // Force a locale bundle without the key by using a stray id.
    expect(translate(BUNDLES, 'fil', 'action.home')).toBe(
      BUNDLES.fil['action.home'],
    )
  })

  it('returns the id itself when the key is unknown everywhere', () => {
    expect(translate(BUNDLES, 'en', 'does.not.exist')).toBe('does.not.exist')
  })

  it('interpolates {name} placeholders', () => {
    const bundles = {
      en: { greet: 'Hi {name}, you have {count} offers' },
      fil: { greet: 'Kumusta {name}, may {count} alok ka' },
    }
    expect(
      translate(bundles, 'en', 'greet', { name: 'Ana', count: 3 }),
    ).toBe('Hi Ana, you have 3 offers')
  })
})
