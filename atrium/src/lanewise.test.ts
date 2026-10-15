import { HANDOFF, READY, openLaneWise, sessionEntries } from './lanewise'

describe('LaneWise handoff', () => {
  beforeEach(() => window.localStorage.clear())

  it('collects only this client’s Amplify session entries', () => {
    localStorage.setItem('CognitoIdentityServiceProvider.client1.LastAuthUser', 'u1')
    localStorage.setItem('CognitoIdentityServiceProvider.client1.u1.idToken', 'id')
    localStorage.setItem('CognitoIdentityServiceProvider.other.u1.idToken', 'nope')
    localStorage.setItem('atrium.lang', 'fil')
    expect(sessionEntries('client1')).toEqual({
      'CognitoIdentityServiceProvider.client1.LastAuthUser': 'u1',
      'CognitoIdentityServiceProvider.client1.u1.idToken': 'id',
    })
  })

  it('posts the session only to LaneWise’s exact origin, after it says ready', () => {
    localStorage.setItem('CognitoIdentityServiceProvider.c.LastAuthUser', 'u')
    const child = { postMessage: vi.fn() } as unknown as Window
    vi.spyOn(window, 'open').mockReturnValue(child)
    openLaneWise('https://lanewise.example.com/anything', 'c')
    expect(window.open).toHaveBeenCalledWith('https://lanewise.example.com/atrium-handoff', '_blank')

    // A message from another origin is ignored.
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.example.com', source: child, data: { type: READY } }))
    expect(child.postMessage).not.toHaveBeenCalled()

    window.dispatchEvent(new MessageEvent('message', { origin: 'https://lanewise.example.com', source: child, data: { type: READY } }))
    expect(child.postMessage).toHaveBeenCalledWith(
      { type: HANDOFF, clientId: 'c', entries: { 'CognitoIdentityServiceProvider.c.LastAuthUser': 'u' } },
      'https://lanewise.example.com',
    )
  })
})
