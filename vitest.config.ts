import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts', './tests/setup-msw.ts', './tests/setup-jsdom.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Most tests in this suite are integration tests that hit the same shared
    // local Supabase instance (and, for some, the same Next dev server) using
    // fixed fixture identifiers (emails, names, etc). Running test files in
    // parallel (Vitest's default) lets them race on shared rows/records and
    // causes flaky cross-file collisions. Disabling file parallelism trades
    // wall-clock speed for reliability, which matters more for a suite that
    // owns real database state. See docs/TEST_INFRASTRUCTURE_PLAN.md for the
    // longer-term plan (isolated schemas/fixtures per file).
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
})
