import { afterEach } from 'vitest'

// Only jsdom files render, so only they load Testing Library (react-dom is slow to import, and importing it in
// every one of the ~500 unit files was a large part of the suite's setup time). Node-environment files have
// nothing to clean up.
if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest')
  const { cleanup } = await import('@testing-library/react')
  afterEach(() => {
    cleanup()
  })
}
