import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Starts a real PostgreSQL for the data-layer tests (test/support/global-setup.ts).
    globalSetup: ['test/support/global-setup.ts'],
    // Each DB test file creates and migrates its own database.
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
