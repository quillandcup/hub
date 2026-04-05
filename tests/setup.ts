import { beforeAll, afterAll } from 'vitest'

// Setup runs once before all tests
beforeAll(async () => {
  // Ensure Supabase is running
  console.log('Setting up tests...')
})

// Cleanup runs once after all tests
afterAll(async () => {
  console.log('Tests complete.')
})
