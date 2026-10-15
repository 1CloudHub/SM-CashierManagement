import { AuthError, isAllowedEmail, toAuthError } from './auth'

describe('auth helpers', () => {
  it('allows only smretail.com and 1cloudhub.com', () => {
    expect(isAllowedEmail('Juan@SMRetail.com')).toBe(true)
    expect(isAllowedEmail('a@1cloudhub.com')).toBe(true)
    expect(isAllowedEmail('a@smretail.com.evil.io')).toBe(false)
    expect(isAllowedEmail('@smretail.com')).toBe(false)
    expect(isAllowedEmail('a@gmail.com')).toBe(false)
  })

  it('maps provider errors to codes', () => {
    expect(toAuthError({ name: 'CodeMismatchException' }).code).toBe('codeMismatch')
    expect(toAuthError({ name: 'NotAuthorizedException', message: 'Invalid session for the user' }).code).toBe('codeExpired')
    expect(toAuthError({ name: 'UserLambdaValidationException', message: "PreSignUp failed with error This work email domain isn't allowed." }).code).toBe('domainNotAllowed')
    expect(toAuthError(new AuthError('noPasskey')).code).toBe('noPasskey')
  })
})
