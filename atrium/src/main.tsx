import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createAuth } from './auth'
import { loadConfig } from './config'
import './styles.css'

const root = createRoot(document.getElementById('root')!)
const config = await loadConfig()

root.render(
  <StrictMode>
    {config ? (
      <App config={config} auth={createAuth(config)} />
    ) : (
      <main className="boot">
        <p>SM Atrium isn't configured (runtime-config.json is missing).</p>
      </main>
    )}
  </StrictMode>,
)
