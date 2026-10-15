import { parseConfig } from './config'

describe('parseConfig', () => {
  const base = { userPoolId: 'us-east-1_AbC123', userPoolClientId: 'abc123def', apiUrl: 'https://x.execute-api.us-east-1.amazonaws.com/', laneWiseUrl: 'https://lanewise.prototypes.1cloudhub.com/home' }

  it('accepts a deploy-written config and normalises URLs', () => {
    expect(parseConfig({ ...base, selfSignUp: 'true' })).toEqual({
      region: 'us-east-1',
      userPoolId: 'us-east-1_AbC123',
      userPoolClientId: 'abc123def',
      selfSignUp: true,
      apiUrl: 'https://x.execute-api.us-east-1.amazonaws.com',
      laneWiseUrl: 'https://lanewise.prototypes.1cloudhub.com',
    })
  })

  it('rejects bad ids and non-https URLs', () => {
    expect(parseConfig({ ...base, userPoolId: 'nope' })).toBeNull()
    expect(parseConfig(null)).toBeNull()
    const c = parseConfig({ ...base, apiUrl: 'http://x', laneWiseUrl: 'javascript:alert(1)' })
    expect(c?.apiUrl).toBeNull()
    expect(c?.laneWiseUrl).toBeNull()
  })
})
