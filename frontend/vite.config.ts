import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// Test config lives in vitest.config.ts so the build's (rolldown) vite types
// stay clean and don't collide with vitest's bundled vite types.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Playwright writes traces (HTML snapshots) under e2e-results/; watching
    // them would full-reload every open page mid-journey (task 25).
    watch: { ignored: ['**/e2e-results/**', '**/playwright-report/**'] },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
