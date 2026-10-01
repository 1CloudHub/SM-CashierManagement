import { describe, expect, it } from 'vitest'
import { EMPTY_FORM, isDateRangeValid, needsScope, scopeInput, toggleRole, validateUserForm } from './logic'

describe('SCR-071 form rules', () => {
  it('requires an allowlisted email (P13), a role and a non-empty region/store choice', () => {
    expect(validateUserForm(EMPTY_FORM, 'invite')).toEqual({ email: 'admin.form.error.emailRequired', roles: 'admin.form.error.roles' })
    expect(validateUserForm({ ...EMPTY_FORM, email: 'a@smretail.com.evil.io', roles: ['PLN'] }, 'invite')).toEqual({ email: 'admin.form.error.domain' })
    expect(validateUserForm({ ...EMPTY_FORM, email: 'A@SMRETAIL.COM ', roles: ['PLN'], scopeType: 'region' }, 'invite')).toEqual({
      scope: 'admin.form.error.region',
    })
    expect(validateUserForm({ ...EMPTY_FORM, roles: ['STF'], scopeType: 'store' }, 'edit')).toEqual({})
  })

  it('keeps roles in matrix order and builds the scope input', () => {
    expect(toggleRole(['STF'], 'ADM', true)).toEqual(['ADM', 'STF'])
    expect(toggleRole(['ADM', 'STF'], 'ADM', false)).toEqual(['STF'])
    expect(needsScope(['STF'])).toBe(false)
    expect(scopeInput({ ...EMPTY_FORM, scopeType: 'store', storeIds: ['s1'] })).toEqual({ type: 'store', storeIds: ['s1'] })
  })

  it('checks the From/To range', () => {
    expect(isDateRangeValid('', '2026-01-01')).toBe(true)
    expect(isDateRangeValid('2026-01-02', '2026-01-01')).toBe(false)
  })
})
