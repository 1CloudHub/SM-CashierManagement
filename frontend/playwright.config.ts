import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end journeys J1–J11 (task 25) against the SPA in mock mode: the Vite
 * dev server with the in-memory mock API (VITE_API_MOCK) and the demo
 * "Viewing as" role switcher, so no AWS, Cognito or database is needed.
 * Run with `npm run test:e2e` (headless Chromium).
 */
const PORT = Number(process.env.E2E_PORT ?? 4317)

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['junit', { outputFile: 'e2e-results/junit.xml' }]] : 'list',
  outputDir: 'e2e-results/artifacts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    locale: 'en-PH',
    timezoneId: 'Asia/Manila',
  },
  projects: [
    { name: 'laptop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { VITE_API_MOCK: 'true', VITE_DEMO_ROLE_SWITCHER: 'true' },
  },
})
