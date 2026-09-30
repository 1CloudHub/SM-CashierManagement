import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App.tsx'
import { AuthNotConfigured, Root } from './app/root'
import { createAmplifyAuthClient } from './features/auth/amplify-auth-client'
import { loadRuntimeConfig } from './features/auth/runtime-config'

const root = createRoot(document.getElementById('root')!)

// Task 7: the app sits behind Cognito passkey sign-in. The Cognito ids come
// from /runtime-config.json (written at deploy) or VITE_* env vars locally.
// Without them, production fails closed; `npm run dev` falls back to the
// component gallery so design-system work needs no AWS.
const config = await loadRuntimeConfig()

root.render(
  <StrictMode>
    {config ? (
      <Root client={createAmplifyAuthClient(config)} />
    ) : import.meta.env.DEV ? (
      <App />
    ) : (
      <AuthNotConfigured />
    )}
  </StrictMode>,
)
