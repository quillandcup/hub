import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders } from '../../helpers/supabase'
import { seedReferenceData } from '../../helpers/seed-data'

/**
 * REGRESSION TEST: Midnight-crossing meetings must be processed correctly
 *
 * BUG CONTEXT:
 * - Production showed 29-31 "orphaned" meetings that increased on reprocess
 * - Root cause: Meetings crossing midnight (11 PM → 1 AM) were missed
 * - Old query logic used containment (gte/lte) which missed overlaps
 * - Fix: Changed to overlap logic (lt/gt) to catch boundary-crossing records
 *
 * This test prevents regression by verifying:
 * 1. Midnight-crossing meetings are processed (not orphaned)
 * 2. Reprocessing the same date range is idempotent
 * 3. DELETE queries catch all overlapping records, not just contained ones
 */
describe('Midnight-Crossing Meeting Reprocessability', () => {
  const supabase = getTestSupabaseAdminClient()

  let testMemberId: string
  let midnightMeetingUuid: string
  let prickleTypeId: string

  beforeAll(async () => {
    // Seed reference data (prickle_types)
    await seedReferenceData()

    // Create test member
    const { data: member } = await supabase
      .from('members')
      .insert({
        name: 'Midnight Test Member',
        email: `midnight-test-${Date.now()}@example.com`,
        joined_at: '2022-01-01',
        status: 'active',
      })
      .select('id')
      .single()

    testMemberId = member!.id

    // Get prickle type
    const { data: pupType } = await supabase
      .from('prickle_types')
      .select('id')
      .eq('name', 'Pop-Up Prickle')
      .single()

    prickleTypeId = pupType!.id

    midnightMeetingUuid = `test-midnight-${Date.now()}`

    // Clean up using OVERLAP logic (not containment)
    // This ensures we catch records that cross date boundaries
    await supabase
      .from('prickle_attendance')
      .delete()
      .lt('join_time', '2099-08-02T00:00:00Z')
      .gt('leave_time', '2099-08-01T00:00:00Z')

    await supabase
      .from('prickles')
      .delete()
      .eq('source', 'zoom')
      .lt('start_time', '2099-08-02T00:00:00Z')
      .gt('end_time', '2099-08-01T00:00:00Z')

    await supabase
      .from('zoom_attendees')
      .delete()
      .lt('join_time', '2099-08-02T00:00:00Z')
      .gt('leave_time', '2099-08-01T00:00:00Z')

    await supabase
      .from('zoom_meetings')
      .delete()
      .lt('start_time', '2099-08-02T00:00:00Z')
      .gt('end_time', '2099-08-01T00:00:00Z')
  })

  afterAll(async () => {
    // Clean up using overlap logic
    await supabase.from('prickle_attendance').delete().eq('member_id', testMemberId)
    await supabase
      .from('prickles')
      .delete()
      .eq('source', 'zoom')
      .lt('start_time', '2099-08-02T00:00:00Z')
      .gt('end_time', '2099-08-01T00:00:00Z')
    await supabase.from('zoom_attendees').delete().ilike('meeting_uuid', 'test-midnight-%')
    await supabase.from('zoom_meetings').delete().ilike('uuid', 'test-midnight-%')
    await supabase.from('members').delete().eq('id', testMemberId)
  })

  it('should process meeting that crosses midnight boundary (Aug 1 23:00 → Aug 2 01:00)', async () => {
    // ARRANGE: Create a meeting that spans Aug 1 → Aug 2
    await supabase.from('zoom_meetings').insert({
      uuid: midnightMeetingUuid,
      topic: 'Late Night Writing Session',
      start_time: '2099-08-01T23:00:00Z',
      end_time: '2099-08-02T01:00:00Z',
      duration: 120,
    })

    await supabase.from('zoom_attendees').insert({
      meeting_id: midnightMeetingUuid, // Required NOT NULL field
      meeting_uuid: midnightMeetingUuid,
      name: 'Midnight Test Member',
      email: null,
      join_time: '2099-08-01T23:00:00Z',
      leave_time: '2099-08-02T01:00:00Z',
      duration: 120,
    })

    // Verify test data was inserted
    const { data: insertedAttendee } = await supabase
      .from('zoom_attendees')
      .select('*')
      .eq('meeting_uuid', midnightMeetingUuid)
      .single()

    console.log('Inserted attendee:', insertedAttendee)
    expect(insertedAttendee).toBeTruthy()

    // ACT: Process Aug 1 (meeting starts on Aug 1, ends on Aug 2)
    const response = await fetch('http://localhost:3000/api/process/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({
        fromDate: '2099-08-01',
        toDate: '2099-08-01', // Single day - but meeting crosses into Aug 2
      }),
    })

    const result = await response.json()

    // ASSERT: Processing succeeded
    console.log('API Response:', JSON.stringify(result, null, 2))
    expect(result.success).toBe(true)
    expect(result.attendanceRecords).toBeGreaterThan(0)

    // Verify attendance was created
    const { data: attendance } = await supabase
      .from('prickle_attendance')
      .select('*')
      .eq('member_id', testMemberId)

    expect(attendance).toHaveLength(1)
    expect(attendance?.[0].join_time).toBe('2099-08-01T23:00:00+00:00')
    expect(attendance?.[0].leave_time).toBe('2099-08-02T01:00:00+00:00')

    // Verify PUP was created
    const { data: pups } = await supabase
      .from('prickles')
      .select('*')
      .eq('source', 'zoom')
      .eq('zoom_meeting_uuid', midnightMeetingUuid)

    expect(pups).toHaveLength(1)
    expect(pups?.[0].start_time).toBe('2099-08-01T23:00:00+00:00')
    expect(pups?.[0].end_time).toBe('2099-08-02T01:00:00+00:00')
  })

  it('should be idempotent when reprocessing same date range', async () => {
    // ARRANGE: Get current state
    const { data: beforeAttendance } = await supabase
      .from('prickle_attendance')
      .select('*')
      .eq('member_id', testMemberId)

    const { data: beforePups } = await supabase
      .from('prickles')
      .select('*')
      .eq('source', 'zoom')
      .eq('zoom_meeting_uuid', midnightMeetingUuid)

    expect(beforeAttendance).toHaveLength(1)
    expect(beforePups).toHaveLength(1)

    // ACT: Reprocess the exact same date range
    const response = await fetch('http://localhost:3000/api/process/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({
        fromDate: '2099-08-01',
        toDate: '2099-08-01',
      }),
    })

    const result = await response.json()
    expect(result.success).toBe(true)

    // ASSERT: Same result (idempotent)
    const { data: afterAttendance } = await supabase
      .from('prickle_attendance')
      .select('*')
      .eq('member_id', testMemberId)

    const { data: afterPups } = await supabase
      .from('prickles')
      .select('*')
      .eq('source', 'zoom')
      .eq('zoom_meeting_uuid', midnightMeetingUuid)

    expect(afterAttendance).toHaveLength(1)
    expect(afterPups).toHaveLength(1)

    // Verify data is identical
    expect(afterAttendance?.[0].join_time).toBe(beforeAttendance?.[0].join_time)
    expect(afterPups?.[0].start_time).toBe(beforePups?.[0].start_time)
  })

  it('should DELETE midnight-crossing records when reprocessing', async () => {
    // This test verifies that the DELETE query uses overlap logic (lt/gt)
    // instead of containment logic (gte/lte)

    // ARRANGE: Create the PUP first by processing
    const setupResponse = await fetch('http://localhost:3000/api/process/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({
        fromDate: '2099-08-01',
        toDate: '2099-08-01',
      }),
    })

    const setupResult = await setupResponse.json()
    expect(setupResult.success).toBe(true)

    // Verify PUP was created
    const { data: pupBefore } = await supabase
      .from('prickles')
      .select('*')
      .eq('source', 'zoom')
      .eq('zoom_meeting_uuid', midnightMeetingUuid)

    expect(pupBefore).toHaveLength(1)

    // Delete the Bronze data (Zoom attendees)
    await supabase
      .from('zoom_attendees')
      .delete()
      .eq('meeting_uuid', midnightMeetingUuid)

    // ACT: Reprocess Aug 1 (meeting starts Aug 1, ends Aug 2)
    // The DELETE query MUST catch this PUP even though end_time is Aug 2
    const response = await fetch('http://localhost:3000/api/process/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({
        fromDate: '2099-08-01',
        toDate: '2099-08-01',
      }),
    })

    const result = await response.json()
    expect(result.success).toBe(true)

    // ASSERT: PUP should be DELETED (not orphaned)
    // Old containment logic (gte/lte) would MISS this deletion because:
    //   end_time (Aug 2 01:00) > toDate (Aug 1 23:59)
    // New overlap logic (lt/gt) CATCHES this deletion because:
    //   start_time (Aug 1 23:00) < toDate (Aug 2 00:00) ✓
    //   end_time (Aug 2 01:00) > fromDate (Aug 1 00:00) ✓
    const { data: pupAfter } = await supabase
      .from('prickles')
      .select('*')
      .eq('source', 'zoom')
      .eq('zoom_meeting_uuid', midnightMeetingUuid)

    expect(pupAfter).toHaveLength(0)

    // Also verify attendance was deleted
    const { data: attendanceAfter } = await supabase
      .from('prickle_attendance')
      .select('*')
      .eq('member_id', testMemberId)

    expect(attendanceAfter).toHaveLength(0)
  })

  it('should handle multiple midnight-crossing meetings in same reprocess', async () => {
    // ARRANGE: Create two meetings that cross midnight
    const meeting1Uuid = `test-midnight-1-${Date.now()}`
    const meeting2Uuid = `test-midnight-2-${Date.now()}`

    await supabase.from('zoom_meetings').insert([
      {
        uuid: meeting1Uuid,
        topic: 'Late Night 1',
        start_time: '2099-08-01T22:30:00Z',
        end_time: '2099-08-02T00:30:00Z',
        duration: 120,
      },
      {
        uuid: meeting2Uuid,
        topic: 'Late Night 2',
        start_time: '2099-08-01T23:45:00Z',
        end_time: '2099-08-02T01:15:00Z',
        duration: 90,
      },
    ])

    await supabase.from('zoom_attendees').insert([
      {
        meeting_id: meeting1Uuid,
        meeting_uuid: meeting1Uuid,
        name: 'Midnight Test Member',
        email: null,
        join_time: '2099-08-01T22:30:00Z',
        leave_time: '2099-08-02T00:30:00Z',
        duration: 120,
      },
      {
        meeting_id: meeting2Uuid,
        meeting_uuid: meeting2Uuid,
        name: 'Midnight Test Member',
        email: null,
        join_time: '2099-08-01T23:45:00Z',
        leave_time: '2099-08-02T01:15:00Z',
        duration: 90,
      },
    ])

    // ACT: Process Aug 1
    const response = await fetch('http://localhost:3000/api/process/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({
        fromDate: '2099-08-01',
        toDate: '2099-08-01',
      }),
    })

    const result = await response.json()

    // ASSERT: Both meetings processed
    expect(result.success).toBe(true)

    const { data: pups } = await supabase
      .from('prickles')
      .select('*')
      .eq('source', 'zoom')
      .in('zoom_meeting_uuid', [meeting1Uuid, meeting2Uuid])

    expect(pups).toHaveLength(2)

    // Clean up
    await supabase.from('zoom_attendees').delete().in('meeting_uuid', [meeting1Uuid, meeting2Uuid])
    await supabase.from('zoom_meetings').delete().in('uuid', [meeting1Uuid, meeting2Uuid])
    await supabase
      .from('prickles')
      .delete()
      .eq('source', 'zoom')
      .in('zoom_meeting_uuid', [meeting1Uuid, meeting2Uuid])
    await supabase
      .from('prickle_attendance')
      .delete()
      .eq('member_id', testMemberId)
      .gte('join_time', '2099-08-01T22:00:00Z')
  })
})
