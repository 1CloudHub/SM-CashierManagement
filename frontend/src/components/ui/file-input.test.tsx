import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { axe } from 'vitest-axe'
import { I18nProvider, formatNumber } from '@/i18n'
import { FileInput } from './file-input'
import { formatFileSize } from './file-size'
import { baseControl } from './input'

function Harness({ onFileChange = vi.fn(), invalid = false }: { onFileChange?: (f: File | null) => void; invalid?: boolean }) {
  const [file, setFile] = useState<File | null>(null)
  return (
    <>
      <label htmlFor="f">Data file</label>
      <FileInput
        id="f"
        file={file}
        invalid={invalid}
        chooseLabel="Choose file"
        emptyLabel="No file chosen"
        onFileChange={(next) => {
          setFile(next)
          onFileChange(next)
        }}
      />
    </>
  )
}

function renderIn(ui: React.ReactNode, locale: 'en' | 'fil' = 'en') {
  return render(<I18nProvider initialLocale={locale}>{ui}</I18nProvider>)
}

describe('FileInput', () => {
  it('is a labelled native file input that reports the chosen file', async () => {
    const onFileChange = vi.fn()
    renderIn(<Harness onFileChange={onFileChange} />)
    const input = screen.getByLabelText('Data file')
    expect(input).toHaveAttribute('type', 'file')
    expect(input).toHaveAccessibleDescription('No file chosen')
    const file = new File(['x'.repeat(1536)], 'stores.csv', { type: 'text/csv' })
    await userEvent.upload(input, file)
    expect(onFileChange).toHaveBeenCalledWith(file)
    expect(screen.getByText('stores.csv')).toBeInTheDocument()
    expect(screen.getByText('1.5 kB')).toBeInTheDocument()
    expect(input).toHaveAccessibleDescription('stores.csv 1.5 kB')
  })

  it('shares the input control recipe (same height and outline as other inputs)', () => {
    renderIn(<Harness />)
    const wrapper = screen.getByLabelText('Data file').parentElement as HTMLElement
    expect(wrapper).toHaveClass('min-h-tap')
    for (const cls of baseControl.split(' ').filter((c) => c.startsWith('border-') && !c.startsWith('border-danger'))) {
      expect(wrapper).toHaveClass(cls)
    }
  })

  it('marks the control invalid', () => {
    renderIn(<Harness invalid />)
    expect(screen.getByLabelText('Data file')).toHaveAttribute('aria-invalid', 'true')
  })

  it('has no axe violations', async () => {
    const { container } = renderIn(<Harness />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('formatFileSize', () => {
  const en = (v: number, o?: Intl.NumberFormatOptions) => formatNumber(v, 'en', o)
  it('picks the largest fitting unit and formats for the locale', () => {
    expect(formatFileSize(1, en)).toBe('1 byte')
    expect(formatFileSize(512, en)).toBe('512 bytes')
    expect(formatFileSize(2048, en)).toBe('2 kB')
    expect(formatFileSize(5.25 * 1024 * 1024, en)).toBe('5.3 MB')
    expect(formatFileSize(1234 * 1024 * 1024, (v, o) => formatNumber(v, 'fil', o))).toMatch(/^1\.2 GB$/)
  })
})
