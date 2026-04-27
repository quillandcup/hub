import { beforeAll, afterEach, afterAll } from 'vitest'
import { setupServer } from 'msw/node'

// Create MSW server instance (handlers added per-test)
export const server = setupServer()

// Start server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))

// Reset handlers after each test
afterEach(() => server.resetHandlers())

// Clean up after all tests
afterAll(() => server.close())
