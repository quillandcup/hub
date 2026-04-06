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
    await supabase.from('prickle_types').insert([
      {
        name: 'Morning Pages',
        description: 'Morning writing session',
        default_duration: 60,
      },
      {
        name: 'Deep Work',
        description: 'Focused work session',
        default_duration: 120,
      },
      {
        name: 'Writing Sprint',
        description: 'Sprint writing session',
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
