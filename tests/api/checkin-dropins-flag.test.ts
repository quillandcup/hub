import { describe, it, expect } from 'vitest'
import { getTestSupabaseAdminClient } from '../helpers/supabase'

/**
 * Drop-in check-ins are switched on for everyone by migration 20270517000000_enable_checkin_dropins.sql
 * (a member who joins a running prickle without a tie gets the check-in, so the check-out is not alone).
 * Turning it off is a feature-flags admin action or a new migration, which changes this test on purpose.
 */
describe('checkin_dropins feature flag', () => {
  const supabase = getTestSupabaseAdminClient()

  it('is on globally once the migrations have run', async () => {
    const { data, error } = await supabase.from('feature_flags').select('enabled_globally').eq('feature_key', 'checkin_dropins').maybeSingle()

    expect(error).toBeNull()
    expect(data?.enabled_globally).toBe(true)
  })
})
