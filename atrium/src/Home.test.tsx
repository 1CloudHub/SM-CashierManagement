import { fireEvent, render, screen } from '@testing-library/react'
import { Home } from './Home'

function setup(lang: 'en' | 'fil' = 'en') {
  const onOpen = vi.fn()
  render(<Home user={{ email: 'demo.storemanager@smretail.com', name: null }} lang={lang} onLang={vi.fn()} onOpen={onOpen} onSignOut={vi.fn()} notice={null} />)
  return { onOpen }
}

describe('Home', () => {
  it('shows the coverage item first and clears it with the A key', () => {
    setup()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("Saturday 20 Dec: you'd be 1 cashier short")
    fireEvent.keyDown(window, { key: 'a' })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('The SM Atrium proposal is ready for your review')
    expect(screen.getByText('Cashier short · Sat 20 Dec').tagName).toBe('S')
    fireEvent.keyDown(window, { key: 'z' })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("you'd be 1 cashier short")
  })

  it('opens live apps from the dock and number keys', () => {
    const { onOpen } = setup()
    fireEvent.click(screen.getByRole('button', { name: /^LaneWise \(1\)/ }))
    expect(onOpen).toHaveBeenCalledWith('lanewise')
    fireEvent.keyDown(window, { key: '2' })
    expect(onOpen).toHaveBeenCalledWith('proposal')
  })

  it('opens the proposal from its queue item', () => {
    const { onOpen } = setup()
    fireEvent.click(screen.getByRole('button', { name: /SM Atrium proposal to review/ }))
    fireEvent.click(screen.getByRole('button', { name: /Open the Exec summary/ }))
    expect(onOpen).toHaveBeenCalledWith('exec')
  })

  it('renders in Filipino', () => {
    setup('fil')
    expect(screen.getByText('MGA APP MO')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sabado 20 Dis: kulang ka ng 1 cashier')
  })
})
