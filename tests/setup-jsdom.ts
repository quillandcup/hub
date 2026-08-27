import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Safe to run for every test file (node-environment tests never render, so
// cleanup() is a no-op for them) — avoids per-environment setupFiles wiring.
afterEach(() => {
  cleanup()
})
