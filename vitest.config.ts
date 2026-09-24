import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// This suite is split into two Vitest "projects" -- see docs/TEST_INFRASTRUCTURE_PLAN.md
// and the "Re-introduce Test Parallelism" entry in docs/TODO.md for the fileParallelism
// history:
//
// - "unit": pure-logic/component tests with no DB, no network, no app server. Every
//   dependency is mocked (vi.mock / vi.fn / stubbed global.fetch) or the test is simply
//   pure functions in, assertions out. Runs with Vitest's default full file parallelism
//   -- there's no shared mutable state for these files to race on.
// - "db": integration tests that hit the real local Supabase instance (directly, or via
//   API routes that hit the DB) and/or require the Next.js app server to be running.
//   Keeps fileParallelism: false because these files share fixed fixture identifiers
//   against one shared local Supabase instance and race each other otherwise.
//
// Directory defaults + named exceptions (rather than one-off per-file globs everywhere)
// keep this enforceable: a new file dropped into tests/api/** or tests/dashboard/**
// defaults to "db" (the overwhelmingly common case there), and a new file anywhere else
// defaults to "unit". Only genuine exceptions to that default are called out below.
const DB_ROOT_FILES = [
  'tests/member-details-membership-history.test.ts',
  'tests/member-matching.test.ts',
  'tests/merge-fix-dismissals.test.ts',
]
// tests/api/** files that are actually pure (fully mocked, or plain fs.readFileSync
// source-string assertions) despite living under tests/api/.
const UNIT_EXCEPTIONS_UNDER_API = [
  'tests/api/process-members-trigger.test.ts',
  'tests/api/require-admin.test.ts',
]
// tests/lib/** files that actually require the local Supabase instance despite living
// under tests/lib/.
const DB_EXCEPTIONS_UNDER_LIB = [
  'tests/lib/bronze-pagination.test.ts',
  'tests/lib/resubscription-data.test.ts',
]

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts', './tests/setup-msw.ts', './tests/setup-jsdom.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: [
            'tests/lib/**/*.test.ts',
            'tests/components/**/*.test.ts',
            'tests/components/**/*.test.tsx',
            'tests/calendar/**/*.test.ts',
            'tests/*.test.ts',
            ...UNIT_EXCEPTIONS_UNDER_API,
          ],
          exclude: [...DB_EXCEPTIONS_UNDER_LIB, ...DB_ROOT_FILES],
        },
      },
      {
        extends: true,
        test: {
          name: 'db',
          include: [
            'tests/api/**/*.test.ts',
            'tests/dashboard/**/*.test.ts',
            'tests/email/**/*.test.ts',
            ...DB_EXCEPTIONS_UNDER_LIB,
            ...DB_ROOT_FILES,
          ],
          exclude: [...UNIT_EXCEPTIONS_UNDER_API],
          // See the file-level comment above -- these tests share one local Supabase
          // instance (and, for some, the same Next app server) using fixed fixture
          // identifiers, so running files in parallel causes flaky cross-file collisions.
          fileParallelism: false,
        },
      },
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
})
