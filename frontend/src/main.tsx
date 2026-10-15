import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { DevApp } from './app/dev-app'
import { AuthNotConfigured, Root } from './app/root'
import { createAmplifyAuthClient } from './features/auth/amplify-auth-client'
import { ATRIUM_HANDOFF_PATH, receiveAtriumHandoff } from './features/auth/atrium-handoff'
import { loadRuntimeConfig } from './features/auth/runtime-config'
import { initTheme } from './lib/theme'

// Apply the persisted light/dark choice before the first render (SG-009).
initTheme()

const root = createRoot(document.getElementById('root')!)

// Task 7: the app sits behind Cognito passkey sign-in. The Cognito ids come
// from /runtime-config.json (written at deploy) or VITE_* env vars locally.
// Without them, production fails closed; `npm run dev` runs the app shell
// without sign-in (mock API; gallery at /gallery) so UI work needs no AWS.
const config = await loadRuntimeConfig()

// SM Atrium single sign-in: take over the session Atrium hands to this tab
// before Amplify starts, then continue at the app root.
if (config && window.location.pathname === ATRIUM_HANDOFF_PATH) {
  await receiveAtriumHandoff({ origins: config.atriumOrigins ?? [], clientId: config.userPoolClientId })
}

root.render(
  <StrictMode>
    {config ? (
      <Root client={createAmplifyAuthClient(config)} apiBaseUrl={config.apiUrl} />
    ) : import.meta.env.DEV ? (
      <DevApp />
    ) : (
      <AuthNotConfigured />
    )}
  </StrictMode>,
)
