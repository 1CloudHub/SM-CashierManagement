// vite-node config for the perf benchmark: plain Node SSR transform, no plugins.
import { defineConfig } from 'vite';

export default defineConfig({
  logLevel: 'warn',
  clearScreen: false,
});
