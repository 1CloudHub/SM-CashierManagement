import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACTIVE_ROLE_HEADER, type ApiAdapter, type ApiRequest } from '@/api'
import { renderApp, useLaptopViewport } from '@/test/app'

beforeEach(() => useLaptopViewport())
afterEach(() => vi.unstubAllGlobals())

const SUMMARY = { id: 'v2', ruleSetId: 'set-wages', version: 2, effectiveFrom: '2026-10-01', isCostRule: true, updatedAt: '' }

function rulesAdapter(log: ApiRequest[]): ApiAdapter {
  return async (req) => {
    log.push(req)
    if (req.path === '/rule-sets') {
      return {
        status: 200,
        body: {
          ruleSets: [
            {
              id: 'set-wages',
              type: 'wages',
              name: 'Wage rates',
              isCostRule: true,
              currentVersion: null,
              openVersion: { ...SUMMARY, status: 'submitted' },
              scenarioCount: 0,
            },
          ],
        },
      }
    }
    if (req.path === '/rule-sets/set-wages/versions') {
      return { status: 200, body: { ruleSet: { id: 'set-wages', type: 'wages', name: 'Wage rates', isCostRule: true }, versions: [] } }
    }
    return { status: 404, body: { error: { code: 'not_found', message: 'We couldn’t find that.', requestId: 'req-9' } } }
  }
}

describe('rules routes (task 8.2 route table)', () => {
  it('SCR-060 loads rule sets with the active role and opens SCR-061 for a version', async () => {
    const log: ApiRequest[] = []
    renderApp({ path: '/rules', role: 'FIN', adapter: rulesAdapter(log) })
    const row = (await screen.findByRole('rowheader', { name: 'Wage rates' })).closest('tr')!
    expect(log.find((r) => r.path === '/rule-sets')?.headers[ACTIVE_ROLE_HEADER]).toBe('FIN')
    await userEvent.click(within(row).getByRole('button', { name: /Review/ }))
    expect(window.location.pathname).toBe('/rules/set-wages/edit')
    expect(window.location.search).toBe('?version=v2')
  })

  it('SCR-061 without a version shows an error when the rule set has none', async () => {
    renderApp({ path: '/rules/set-wages/edit', role: 'RST', adapter: rulesAdapter([]) })
    expect(screen.getByRole('heading', { level: 1, name: 'Rule version editor' })).toBeInTheDocument()
    expect(await screen.findByText('We couldn’t load this rule version.')).toBeInTheDocument()
  })
})
