import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../helpers/supabase'

/**
 * Test to ensure attendance table allows multiple records per (member_id, prickle_id)
 *
 * CRITICAL: People can leave and rejoin the same meeting. We must preserve this
 * detail to accurately track attendance time and patterns.
 *
 * Example: Alice joins at 9am, leaves at 9:30am, rejoins at 11am, stays until 11:30am
 * - Total time: 60 minutes (NOT 150 minutes if we merged 9am-11:30am)
 * - Two separate attendance records preserve actual behavior
 */
describe('Attendance Multiple Records', () => {
  const supabase = getTestSupabaseAdminClient()
  let testMemberId: string
  let testPrickleId: string

  beforeAll(async () => {
    // Create test member
    const { data: member, error: memberError } = await supabase
      .from('members')
      .insert({
        name: 'Test Member',
        email: `test-${Date.now()}@example.com`,
        joined_at: new Date().toISOString(),
        status: 'active',
      })
      .select('id')
      .single()

    expect(memberError).toBeNull()
    testMemberId = member!.id

    // Create test prickle
    const { data: prickleType } = await supabase
      .from('prickle_types')
      .select('id')
      .limit(1)
      .single()

    const { data: prickle, error: prickleError } = await supabase
      .from('prickles')
      .insert({
        type_id: prickleType!.id,
        start_time: new Date(2099, 0, 1, 9, 0).toISOString(),
        end_time: new Date(2099, 0, 1, 12, 0).toISOString(),
        source: 'calendar',
      })
      .select('id')
      .single()

    expect(prickleError).toBeNull()
    testPrickleId = prickle!.id
  })

  afterAll(async () => {
    // Clean up
    await supabase.from('attendance').delete().eq('member_id', testMemberId)
    await supabase.from('prickles').delete().eq('id', testPrickleId)
    await supabase.from('members').delete().eq('id', testMemberId)
  })

  it('should allow multiple attendance records for same (member_id, prickle_id)', async () => {
    // Person joins at 9:00, leaves at 9:30
    const { error: error1 } = await supabase
      .from('attendance')
      .insert({
        member_id: testMemberId,
        prickle_id: testPrickleId,
        join_time: new Date(2099, 0, 1, 9, 0).toISOString(),
        leave_time: new Date(2099, 0, 1, 9, 30).toISOString(),
        confidence_score: 'high',
      })

    expect(error1).toBeNull()

    // Person rejoins at 11:00, leaves at 11:30
    const { error: error2 } = await supabase
      .from('attendance')
      .insert({
        member_id: testMemberId,
        prickle_id: testPrickleId,
        join_time: new Date(2099, 0, 1, 11, 0).toISOString(),
        leave_time: new Date(2099, 0, 1, 11, 30).toISOString(),
        confidence_score: 'high',
      })

    expect(error2).toBeNull()

    // Verify both records exist
    const { data: records, error: fetchError } = await supabase
      .from('attendance')
      .select('*')
      .eq('member_id', testMemberId)
      .eq('prickle_id', testPrickleId)

    expect(fetchError).toBeNull()
    expect(records).toHaveLength(2)
  })

  it('should calculate correct total attendance time from multiple records', async () => {
    // Query for total time
    const { data: records } = await supabase
      .from('attendance')
      .select('join_time, leave_time')
      .eq('member_id', testMemberId)
      .eq('prickle_id', testPrickleId)

    // Calculate total duration in minutes
    const totalMinutes = records!.reduce((sum, record) => {
      const duration = (new Date(record.leave_time).getTime() - new Date(record.join_time).getTime()) / (60 * 1000)
      return sum + duration
    }, 0)

    // Should be 30 + 30 = 60 minutes, NOT 150 minutes (11:30 - 9:00)
    expect(totalMinutes).toBe(60)
  })

  it('should count unique prickles correctly despite multiple records', async () => {
    // Count distinct prickles attended
    const { data, error } = await supabase
      .from('attendance')
      .select('prickle_id')
      .eq('member_id', testMemberId)

    expect(error).toBeNull()

    // Two attendance records but only ONE unique prickle
    const uniquePrickles = new Set(data!.map(r => r.prickle_id))
    expect(data!.length).toBe(2) // Two records
    expect(uniquePrickles.size).toBe(1) // One unique prickle
  })

  it('should verify attendance exists even with multiple records', async () => {
    // Check if member attended this prickle (should return true)
    const { data, error } = await supabase
      .from('attendance')
      .select('id')
      .eq('member_id', testMemberId)
      .eq('prickle_id', testPrickleId)
      .limit(1)
      .single()

    expect(error).toBeNull()
    expect(data).toBeTruthy()
  })

  it('should preserve actual join/leave times without merging', async () => {
    const { data: records } = await supabase
      .from('attendance')
      .select('join_time, leave_time')
      .eq('member_id', testMemberId)
      .eq('prickle_id', testPrickleId)
      .order('join_time')

    expect(records).toHaveLength(2)

    // First session: 9:00 - 9:30
    expect(new Date(records![0].join_time).getHours()).toBe(9)
    expect(new Date(records![0].join_time).getMinutes()).toBe(0)
    expect(new Date(records![0].leave_time).getHours()).toBe(9)
    expect(new Date(records![0].leave_time).getMinutes()).toBe(30)

    // Second session: 11:00 - 11:30
    expect(new Date(records![1].join_time).getHours()).toBe(11)
    expect(new Date(records![1].join_time).getMinutes()).toBe(0)
    expect(new Date(records![1].leave_time).getHours()).toBe(11)
    expect(new Date(records![1].leave_time).getMinutes()).toBe(30)
  })
})
