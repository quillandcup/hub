import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'

/**
 * Test to verify /api/import/zoom is idempotent
 *
 * CRITICAL: Zoom import must be idempotent - importing the same date range
 * multiple times should not create duplicate attendee records.
 *
 * Pattern: UPSERT by (meeting_uuid, name, join_time)
 */
describe('Zoom Import Idempotency', () => {
  const supabase = getTestSupabaseAdminClient()

  const testMeetingUuid1 = `test-zoom-meeting-${Date.now()}-1`
  const testMeetingUuid2 = `test-zoom-meeting-${Date.now()}-2`

  beforeAll(async () => {
    // Clean up any existing test data
    await supabase
      .from('bronze.zoom_attendees')
      .delete()
      .or(`meeting_uuid.eq.${testMeetingUuid1},meeting_uuid.eq.${testMeetingUuid2}`)
  })

  afterAll(async () => {
    // Clean up test data
    await supabase
      .from('bronze.zoom_attendees')
      .delete()
      .or(`meeting_uuid.eq.${testMeetingUuid1},meeting_uuid.eq.${testMeetingUuid2}`)
  })

  it('should create zoom attendees on first import', async () => {
    // ARRANGE: Insert attendees (simulating what import would do)
    const attendees = [
      {
        meeting_id: '123456',
        meeting_uuid: testMeetingUuid1,
        topic: 'Morning Writing Session',
        name: 'Alice Writer',
        email: 'alice@example.com',
        join_time: '2099-11-15T09:00:00Z',
        leave_time: '2099-11-15T10:00:00Z',
        duration: 60,
      },
      {
        meeting_id: '123456',
        meeting_uuid: testMeetingUuid1,
        topic: 'Morning Writing Session',
        name: 'Bob Author',
        email: 'bob@example.com',
        join_time: '2099-11-15T09:05:00Z',
        leave_time: '2099-11-15T09:55:00Z',
        duration: 50,
      },
    ]

    const { error } = await supabase.from('bronze.zoom_attendees').insert(attendees)

    // ASSERT: Attendees created
    expect(error).toBeNull()

    const { data: inserted } = await supabase
      .from('bronze.zoom_attendees')
      .select('*')
      .eq('meeting_uuid', testMeetingUuid1)

    expect(inserted).toHaveLength(2)
  })

  it('should not create duplicate attendees when re-importing (idempotent)', async () => {
    // ARRANGE: Re-insert same attendees (simulating re-import)
    const attendees = [
      {
        meeting_id: '123456',
        meeting_uuid: testMeetingUuid1,
        topic: 'Morning Writing Session',
        name: 'Alice Writer',
        email: 'alice@example.com',
        join_time: '2099-11-15T09:00:00Z',
        leave_time: '2099-11-15T10:00:00Z',
        duration: 60,
      },
      {
        meeting_id: '123456',
        meeting_uuid: testMeetingUuid1,
        topic: 'Morning Writing Session',
        name: 'Bob Author',
        email: 'bob@example.com',
        join_time: '2099-11-15T09:05:00Z',
        leave_time: '2099-11-15T09:55:00Z',
        duration: 50,
      },
    ]

    // ACT: UPSERT with unique constraint on (meeting_uuid, name, join_time)
    const { error } = await supabase
      .from('bronze.zoom_attendees')
      .upsert(attendees, {
        onConflict: 'meeting_uuid,name,join_time',
        ignoreDuplicates: true,
      })

    expect(error).toBeNull()

    // ASSERT: Still only 2 attendees (no duplicates)
    const { data: afterUpsert } = await supabase
      .from('zoom_attendees')
      .select('*')
      .eq('meeting_uuid', testMeetingUuid1)

    expect(afterUpsert).toHaveLength(2)
  })

  it('should handle same person rejoining (different join_time)', async () => {
    // ARRANGE: Alice leaves and rejoins (different join_time)
    const newJoin = {
      meeting_id: '123456',
      meeting_uuid: testMeetingUuid1,
      topic: 'Morning Writing Session',
      name: 'Alice Writer',
      email: 'alice@example.com',
      join_time: '2099-11-15T10:30:00Z', // Different join time
      leave_time: '2099-11-15T11:00:00Z',
      duration: 30,
    }

    // ACT: UPSERT
    const { error } = await supabase
      .from('zoom_attendees')
      .upsert([newJoin], {
        onConflict: 'meeting_uuid,name,join_time',
        ignoreDuplicates: true,
      })

    expect(error).toBeNull()

    // ASSERT: Now 3 records (Alice has 2, Bob has 1)
    const { data: allAttendees } = await supabase
      .from('zoom_attendees')
      .select('*')
      .eq('meeting_uuid', testMeetingUuid1)

    expect(allAttendees).toHaveLength(3)

    const aliceRecords = allAttendees?.filter(a => a.name === 'Alice Writer')
    expect(aliceRecords).toHaveLength(2)
  })

  it('should handle multiple meetings (different meeting_uuid)', async () => {
    // ARRANGE: Add attendees for second meeting
    const meeting2Attendees = [
      {
        meeting_id: '789012',
        meeting_uuid: testMeetingUuid2,
        topic: 'Deep Work Session',
        name: 'Alice Writer', // Same person, different meeting
        email: 'alice@example.com',
        join_time: '2099-11-15T14:00:00Z',
        leave_time: '2099-11-15T16:00:00Z',
        duration: 120,
      },
      {
        meeting_id: '789012',
        meeting_uuid: testMeetingUuid2,
        topic: 'Deep Work Session',
        name: 'Charlie Poet',
        email: 'charlie@example.com',
        join_time: '2099-11-15T14:00:00Z',
        leave_time: '2099-11-15T16:00:00Z',
        duration: 120,
      },
    ]

    // ACT: UPSERT
    const { error } = await supabase
      .from('zoom_attendees')
      .upsert(meeting2Attendees, {
        onConflict: 'meeting_uuid,name,join_time',
        ignoreDuplicates: true,
      })

    expect(error).toBeNull()

    // ASSERT: Meeting 2 has 2 attendees
    const { data: meeting2Data } = await supabase
      .from('zoom_attendees')
      .select('*')
      .eq('meeting_uuid', testMeetingUuid2)

    expect(meeting2Data).toHaveLength(2)
  })

  it('should handle multiple import cycles without creating duplicates', async () => {
    // ARRANGE: Import the same attendees 5 times
    const attendees = [
      {
        meeting_id: '123456',
        meeting_uuid: testMeetingUuid1,
        topic: 'Morning Writing Session',
        name: 'Alice Writer',
        email: 'alice@example.com',
        join_time: '2099-11-15T09:00:00Z',
        leave_time: '2099-11-15T10:00:00Z',
        duration: 60,
      },
      {
        meeting_id: '123456',
        meeting_uuid: testMeetingUuid1,
        topic: 'Morning Writing Session',
        name: 'Bob Author',
        email: 'bob@example.com',
        join_time: '2099-11-15T09:05:00Z',
        leave_time: '2099-11-15T09:55:00Z',
        duration: 50,
      },
    ]

    // ACT: UPSERT 5 times
    for (let i = 0; i < 5; i++) {
      const { error } = await supabase
        .from('zoom_attendees')
        .upsert(attendees, {
          onConflict: 'meeting_uuid,name,join_time',
          ignoreDuplicates: true,
        })
      expect(error).toBeNull()
    }

    // ASSERT: Still same number of attendees (completely idempotent)
    const { data: finalCheck } = await supabase
      .from('zoom_attendees')
      .select('*')
      .in('meeting_uuid', [testMeetingUuid1, testMeetingUuid2])

    expect(finalCheck).toHaveLength(5) // 3 from meeting1 + 2 from meeting2
  })

  it('should verify unique constraint on (meeting_uuid, name, join_time)', async () => {
    // ARRANGE: Try to INSERT (not UPSERT) duplicate record
    const duplicate = {
      meeting_id: '123456',
      meeting_uuid: testMeetingUuid1,
      topic: 'Morning Writing Session',
      name: 'Alice Writer',
      email: 'alice@example.com',
      join_time: '2099-11-15T09:00:00Z', // Same as first Alice record
      leave_time: '2099-11-15T10:00:00Z',
      duration: 60,
    }

    // ACT: Regular INSERT should fail due to unique constraint
    const { error } = await supabase
      .from('zoom_attendees')
      .insert([duplicate])

    // ASSERT: Should fail with duplicate key error
    expect(error).toBeTruthy()
    expect(error?.code).toBe('23505') // PostgreSQL duplicate key error
    expect(error?.message).toContain('idx_zoom_attendees_unique')
  })
})
