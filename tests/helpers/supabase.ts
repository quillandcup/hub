import { createClient } from '@supabase/supabase-js'

// Create Supabase client for testing against local instance
// Uses anon key for read-only queries
export function getTestSupabaseClient() {
  const supabaseUrl = 'http://127.0.0.1:54321'
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

  return createClient(supabaseUrl, supabaseAnonKey)
}

// Create admin client with service role key that bypasses RLS
// Use this for test setup/teardown and data insertion
export function getTestSupabaseAdminClient() {
  const supabaseUrl = 'http://127.0.0.1:54321'
  // Local Supabase service role key (safe to hardcode for local testing)
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })
}

/**
 * Get auth headers for API route testing
 *
 * Uses service role key to bypass auth checks in integration tests.
 * The service role key is passed in the Authorization header, and Next.js
 * routes will recognize it via the Supabase client.
 */
export function getTestAuthHeaders() {
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

  return {
    'Authorization': `Bearer ${supabaseServiceKey}`,
    'apikey': supabaseServiceKey,
  }
}
