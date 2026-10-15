import { acceptHandoff, receiveAtriumHandoff } from './atrium-handoff'
import { parseRuntimeConfig } from './runtime-config'

const ATRIUM = 'https://atrium.prototypes.1cloudhub.com'
const entries = { 'CognitoIdentityServiceProvider.c1.LastAuthUser': 'u', 'CognitoIdentityServiceProvider.c1.u.idToken': 'jwt' }

describe('Atrium handoff', () => {
  beforeEach(() => window.localStorage.clear())

  it('accepts only this client’s session keys', () => {
    expect(acceptHandoff({ type: 'atrium:handoff', clientId: 'c1', entries }, 'c1')).toEqual(entries)
    expect(acceptHandoff({ type: 'atrium:handoff', clientId: 'c2', entries }, 'c1')).toBeNull()
    expect(acceptHandoff({ type: 'atrium:handoff', clientId: 'c1', entries: { 'evil.key': 'x' } }, 'c1')).toBeNull()
    expect(acceptHandoff({ type: 'other', clientId: 'c1', entries }, 'c1')).toBeNull()
  })

  it('stores the session from the opener at an allowed origin, then leaves the handoff URL', async () => {
    const opener = { postMessage: vi.fn() } as unknown as Window
    Object.defineProperty(window, 'opener', { value: opener, configurable: true })
    window.history.replaceState(null, '', '/atrium-handoff')
    const done = receiveAtriumHandoff({ origins: [ATRIUM], clientId: 'c1' })
    expect(opener.postMessage).toHaveBeenCalledWith({ type: 'lanewise:handoff-ready' }, ATRIUM)

    // Wrong origin, then wrong source: both ignored.
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.example.com', source: opener, data: { type: 'atrium:handoff', clientId: 'c1', entries } }))
    window.dispatchEvent(new MessageEvent('message', { origin: ATRIUM, source: window, data: { type: 'atrium:handoff', clientId: 'c1', entries } }))
    expect(localStorage.length).toBe(0)

    window.dispatchEvent(new MessageEvent('message', { origin: ATRIUM, source: opener, data: { type: 'atrium:handoff', clientId: 'c1', entries } }))
    await expect(done).resolves.toBe(true)
    expect(localStorage.getItem('CognitoIdentityServiceProvider.c1.u.idToken')).toBe('jwt')
    expect(window.location.pathname).toBe('/')
    Object.defineProperty(window, 'opener', { value: null, configurable: true })
  })

  it('continues to normal sign-in without an opener', async () => {
    window.history.replaceState(null, '', '/atrium-handoff')
    await expect(receiveAtriumHandoff({ origins: [ATRIUM], clientId: 'c1' })).resolves.toBe(false)
    expect(window.location.pathname).toBe('/')
  })

  it('reads allowed Atrium origins from the runtime config', () => {
    const c = parseRuntimeConfig({ userPoolId: 'us-east-1_Abc', userPoolClientId: 'abc', atriumOrigins: [ATRIUM, 'http://insecure.example.com', 'https://x.com/path'] })
    expect(c?.atriumOrigins).toEqual([ATRIUM])
    expect(parseRuntimeConfig({ userPoolId: 'us-east-1_Abc', userPoolClientId: 'abc' })).not.toHaveProperty('atriumOrigins')
  })
})
