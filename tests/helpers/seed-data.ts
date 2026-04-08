import { getTestSupabaseAdminClient } from './supabase'

/**
 * Seed reference data needed for tests
 *
 * This ensures tests have the required reference tables populated:
 * - prickle_types (for calendar/attendance processing)
 * - members (for attendance processing)
 */
export async function seedReferenceData() {
  const supabase = getTestSupabaseAdminClient()

  // Seed prickle_types
  const { data: existingTypes } = await supabase
    .from('prickle_types')
    .select('id, name')
    .limit(1)

  if (!existingTypes || existingTypes.length === 0) {
    // Seed essential prickle types needed for tests
    // normalized_name is computed by DB trigger, so we don't need to set it
    await supabase.from('prickle_types').insert([
      {
        name: 'Pop-Up Prickle',
        description: 'Unscheduled writing session',
        default_duration: 60,
      },
      {
        name: 'Progress Prickle',
        description: 'Default prickle type for scheduled sessions',
        default_duration: 60,
      },
      {
        name: 'Heads Down',
        description: 'Focused writing session',
        default_duration: 60,
      },
      {
        name: 'Sprint Prickle',
        description: 'Short sprint writing session',
        default_duration: 30,
      },
    ])
  }

  // Seed test members (for attendance processing)
  const testMemberEmail = 'test-seed-member@example.com'
  const { data: existingMember } = await supabase
    .from('members')
    .select('id')
    .eq('email', testMemberEmail)
    .single()

  if (!existingMember) {
    await supabase.from('members').insert({
      name: 'Test Seed Member',
      email: testMemberEmail,
      joined_at: new Date('2022-01-01').toISOString(),
      status: 'active',
    })
  }
}

/**
 * Clean up reference data after tests
 */
export async function cleanupReferenceData() {
  const supabase = getTestSupabaseAdminClient()

  // Clean up test member
  await supabase
    .from('members')
    .delete()
    .eq('email', 'test-seed-member@example.com')

  // Note: Don't clean up prickle_types as they're needed across test runs
}
