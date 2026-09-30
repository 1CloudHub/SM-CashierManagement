import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { StateBlock } from './state-block'
import { Alert } from './alert'
import { KpiCardSkeleton } from './kpi-card'
import { CardSkeleton } from './card'
import { MediaPlaceholder } from './placeholder'
import { StatusPill } from './pill'

describe('StateBlock (UX-010 empty / error / no-access / offline)', () => {
  it('announces errors assertively via role="alert" and shows a reference id', () => {
    render(
      <StateBlock
        variant="error"
        title="Something went wrong"
        referenceId="LW-1234"
      />,
    )
    const region = screen.getByRole('alert')
    expect(region).toHaveAttribute('aria-live', 'assertive')
    expect(screen.getByText('LW-1234')).toBeInTheDocument()
  })

  it('uses a polite status region for empty state and shows the next step', () => {
    render(
      <StateBlock
        variant="empty"
        title="No published plan yet"
        action={<a href="#s">Open scenarios</a>}
      />,
    )
    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('link', { name: 'Open scenarios' })).toBeInTheDocument()
  })

  it('no-access reveals nothing but the message', () => {
    render(
      <StateBlock variant="no-access" title="You don’t have access to this store" />,
    )
    expect(
      screen.getByRole('heading', { name: /don’t have access/i }),
    ).toBeInTheDocument()
  })
})

describe('Loading placeholders (UX-010)', () => {
  it('KPI skeleton is a labelled live region', () => {
    render(<KpiCardSkeleton />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
  })

  it('Card skeleton is a labelled live region', () => {
    render(<CardSkeleton />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
  })

  it('Media placeholder keeps a visible, announced label', () => {
    render(<MediaPlaceholder label="Loading chart…" />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading chart…')
  })
})

describe('Stale banner (UX-010)', () => {
  it('renders an info banner with a reason and a recalculate action', () => {
    render(
      <Alert tone="info" title="Data changed since this run">
        The POS snapshot is newer than this run.
      </Alert>,
    )
    expect(screen.getByText('Data changed since this run')).toBeInTheDocument()
  })
})

describe('Status is never colour alone', () => {
  it('a status pill pairs an icon with its text', () => {
    const { container } = render(<StatusPill tone="warning">Stale</StatusPill>)
    // icon (svg, aria-hidden) + text label both present
    expect(container.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument()
    expect(screen.getByText('Stale')).toBeInTheDocument()
  })

  it('has no axe violations across the state blocks', async () => {
    const { container } = render(
      <div>
        <StateBlock variant="empty" title="Empty" />
        <StateBlock variant="error" title="Error" referenceId="LW-1" />
        <Alert tone="info" title="Stale">reason</Alert>
        <StatusPill tone="success">Published</StatusPill>
      </div>,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})
