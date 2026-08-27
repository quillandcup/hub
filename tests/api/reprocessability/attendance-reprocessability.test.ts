import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders } from '../../helpers/supabase'
import { seedReferenceData } from '../../helpers/seed-data'

/**
 * Test to verify /api/process/attendance is fully reprocessable
 *
 * CRITICAL: Attendance processing must use DELETE + INSERT pattern.
 * This test prevents regressions where UPSERT was used, leaving
 * orphaned attendance records when Zoom data is deleted.
 *
 * Core principle: Silver layer must be fully regenerable from Bronze.
 * If Zoom attendance data is deleted, reprocessing should remove the
 * corresponding attendance records and PUPs from the database.
 */
describe('Attendance Reprocessability', () => {
  const supabase = getTestSupabaseAdminClient()
  const testDateRange = {
    from: '2099-05-01',
    to: '2099-05-31',
  }

  let testMemberId: string
  let testMeetingUuid: string
  let prickleTypeId: string

  beforeAll(async () => {
    // Seed reference data (prickle_types)
    await seedReferenceData()

    // Create test member
    const { data: member } = await supabase
      .from('members')
      .insert({
        name: 'Reprocess Test Member',
        email: `reprocess-attendance-${Date.now()}@example.com`,
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

    testMeetingUuid = `test-meeting-${Date.now()}`

    // Clean up any existing test data using OVERLAP logic (not containment)
    // Use lt(nextMonthStart) and gt(monthStart) to catch boundary-crossing records
    await supabase
      .from('prickle_attendance')
      .delete()
      .lt('join_time', '2099-06-01T00:00:00Z')
      .gt('leave_time', `${testDateRange.from}T00:00:00Z`)

    await supabase
      .from('prickles')
      .delete()
      .eq('source', 'zoom')
      .lt('start_time', '2099-06-01T00:00:00Z')
      .gt('end_time', `${testDateRange.from}T00:00:00Z`)

    await supabase
      .schema('bronze').from('zoom_attendees')
      .delete()
      .lt('join_time', '2099-06-01T00:00:00Z')
      .gt('leave_time', `${testDateRange.from}T00:00:00Z`)

    await supabase
      .schema('bronze').from('zoom_meetings')
      .delete()
      .lt('start_time', '2099-06-01T00:00:00Z')
      .gt('end_time', `${testDateRange.from}T00:00:00Z`)
  })

  afterAll(async () => {
    // Clean up using overlap logic to ensure we catch all test data
    await supabase.from('prickle_attendance').delete().eq('member_id', testMemberId)
    await supabase
      .from('prickles')
      .delete()
      .eq('source', 'zoom')
      .lt('start_time', '2099-06-01T00:00:00Z')
      .gt('end_time', `${testDateRange.from}T00:00:00Z`)
    await supabase.schema('bronze').from('zoom_attendees').delete().ilike('meeting_uuid', 'test-meeting-%')
    await supabase.schema('bronze').from('zoom_meetings').delete().ilike('uuid', 'test-meeting-%')
    await supabase.from('members').delete().eq('id', testMemberId)
  })

  it('should create attendance records from Zoom data on first process', async () => {
    // ARRANGE: Insert Bronze Zoom data
    await supabase.schema('bronze').from('zoom_meetings').insert({
      meeting_uuid: testMeetingUuid,
      meeting_id: testMeetingUuid,
      topic: 'Test Meeting',
      start_time: '2099-05-15T10:00:00Z',
      end_time: '2099-05-15T11:00:00Z',
      duration_minutes: 60,
      data: {},
    })

    await supabase.schema('bronze').from('zoom_attendees').insert({
      meeting_id: testMeetingUuid,
      meeting_uuid: testMeetingUuid,
      name: 'Reprocess Test Member',
      email: null, // Will match by name
      join_time: '2099-05-15T10:05:00Z',
      leave_time: '2099-05-15T10:55:00Z',
      duration: 50,
    })

    // ACT: Process attendance
    const response = await fetch('http://localhost:3000/api/process/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({
        fromDate: testDateRange.from,
        toDate: testDateRange.to,
      }),
    })

    const result = await response.json()

    // ASSERT: Attendance created
    expect(result.success).toBe(true)
    expect(result.attendanceRecords).toBeGreaterThan(0)

    const { data: attendance } = await supabase
      .from('prickle_attendance')
      .select('*')
      .eq('member_id', testMemberId)

    expect(attendance).toHaveLength(1)
    expect(attendance?.[0].join_time).toBe('2099-05-15T10:05:00+00:00')
  })

  it('should remove attendance when Zoom data is deleted', async () => {
    // ARRANGE: Delete the Zoom attendee record
    await supabase
      .schema('bronze').from('zoom_attendees')
      .delete()
      .eq('meeting_uuid', testMeetingUuid)

    // ACT: Reprocess
    const response = await fetch('http://localhost:3000/api/process/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({
        fromDate: testDateRange.from,
        toDate: testDateRange.to,
      }),
    })

    const result = await response.json()

    // ASSERT: Attendance record removed
    expect(result.success).toBe(true)

    const { data: attendance } = await supabase
      .from('prickle_attendance')
      .select('*')
      .eq('member_id', testMemberId)

    expect(attendance).toHaveLength(0)
  })

  it('should remove PUPs when Zoom meeting is deleted', async () => {
    // ARRANGE: Create a PUP by having a Zoom meeting without calendar match
    const pupMeetingUuid = `test-meeting-pup-${Date.now()}`

    await supabase.schema('bronze').from('zoom_meetings').insert({
      meeting_uuid: pupMeetingUuid,
      meeting_id: pupMeetingUuid,
      topic: 'Unscheduled Writing',
      start_time: '2099-05-20T14:00:00Z',
      end_time: '2099-05-20T15:00:00Z',
      duration_minutes: 60,
      data: {},
    })

    await supabase.schema('bronze').from('zoom_attendees').insert({
      meeting_id: pupMeetingUuid,
      meeting_uuid: pupMeetingUuid,
      name: 'Reprocess Test Member',
      email: null,
      join_time: '2099-05-20T14:00:00Z',
      leave_time: '2099-05-20T15:00:00Z',
      duration: 60,
    })

    // Process to create PUP
    await fetch('http://localhost:3000/api/process/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({
        fromDate: testDateRange.from,
        toDate: testDateRange.to,
      }),
    })

    // Verify PUP created
    const { data: pupBefore } = await supabase
      .from('prickles')
      .select('*')
      .eq('source', 'zoom')
      .eq('start_time', '2099-05-20T14:00:00+00:00')

    expect(pupBefore).toBeTruthy()
    expect(pupBefore?.length).toBeGreaterThan(0)

    // ARRANGE: Delete Zoom meeting
    await supabase.schema('bronze').from('zoom_attendees').delete().eq('meeting_uuid', pupMeetingUuid)
    await supabase.schema('bronze').from('zoom_meetings').delete().eq('meeting_uuid', pupMeetingUuid)

    // ACT: Reprocess
    const response = await fetch('http://localhost:3000/api/process/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({
        fromDate: testDateRange.from,
        toDate: testDateRange.to,
      }),
    })

    const result = await response.json()

    // ASSERT: PUP removed
    expect(result.success).toBe(true)

    const { data: pupAfter } = await supabase
      .from('prickles')
      .select('*')
      .eq('source', 'zoom')
      .eq('start_time', '2099-05-20T14:00:00+00:00')

    expect(pupAfter).toHaveLength(0)
  })

  it('should preserve PUP UUIDs across attendance reprocessing (stable links)', async () => {
    // Reprocessing the same Zoom data must not change PUP UUIDs.
    // Broken URLs (/admin/prickles/<id>) are the symptom when this fails.
    const stableMeetingUuid = `test-meeting-stable-${Date.now()}`

    await supabase.schema('bronze').from('zoom_meetings').insert({
      meeting_uuid: stableMeetingUuid,
      meeting_id: stableMeetingUuid,
      topic: 'Stable PUP Test',
      start_time: '2099-05-18T10:00:00Z',
      end_time: '2099-05-18T11:00:00Z',
      duration_minutes: 60,
      data: {},
    })
    await supabase.schema('bronze').from('zoom_attendees').insert({
      meeting_id: stableMeetingUuid,
      meeting_uuid: stableMeetingUuid,
      name: 'Reprocess Test Member',
      email: null,
      join_time: '2099-05-18T10:00:00Z',
      leave_time: '2099-05-18T11:00:00Z',
      duration: 60,
    })

    await fetch('http://localhost:3000/api/process/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({ fromDate: testDateRange.from, toDate: testDateRange.to }),
    })

    const { data: pupBefore } = await supabase
      .from('prickles')
      .select('id')
      .eq('source', 'zoom')
      .eq('zoom_meeting_uuid', stableMeetingUuid)
      .single()
    expect(pupBefore).toBeTruthy()
    const pupId = pupBefore!.id

    // Reprocess with the same Zoom data
    const response = await fetch('http://localhost:3000/api/process/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({ fromDate: testDateRange.from, toDate: testDateRange.to }),
    })
    expect((await response.json()).success).toBe(true)

    const { data: pupAfter } = await supabase
      .from('prickles')
      .select('id')
      .eq('source', 'zoom')
      .eq('zoom_meeting_uuid', stableMeetingUuid)
      .single()
    expect(pupAfter?.id).toBe(pupId)

    // Clean up
    await supabase.schema('bronze').from('zoom_attendees').delete().eq('meeting_uuid', stableMeetingUuid)
    await supabase.schema('bronze').from('zoom_meetings').delete().eq('meeting_uuid', stableMeetingUuid)
  })

  it('should verify orphan PUPs and attendance are removed on reprocess', async () => {
    // A PUP with no zoom_meeting_uuid has no stable key and no Bronze source,
    // so reprocessing must remove it and its attendance records.
    const { data: orphanPrickle } = await supabase.from('prickles').insert({
      type_id: prickleTypeId,
      start_time: '2099-05-25T16:00:00Z',
      end_time: '2099-05-25T17:00:00Z',
      source: 'zoom',
    }).select('id').single()

    await supabase.from('prickle_attendance').insert({
      member_id: testMemberId,
      prickle_id: orphanPrickle!.id,
      join_time: '2099-05-25T16:00:00Z',
      leave_time: '2099-05-25T17:00:00Z',
      confidence_score: 'high',
    })

    // Verify orphan exists
    const { data: before } = await supabase
      .from('prickle_attendance')
      .select('*')
      .eq('join_time', '2099-05-25T16:00:00+00:00')
      .single()

    expect(before).toBeTruthy()

    // ACT: Process attendance (should DELETE all in range, then INSERT from Bronze)
    const response = await fetch('http://localhost:3000/api/process/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({
        fromDate: testDateRange.from,
        toDate: testDateRange.to,
      }),
    })

    const result = await response.json()
    expect(result.success).toBe(true)

    // ASSERT: Orphan should be GONE (DELETE + INSERT removes it)
    // If UPSERT was used, orphan would still exist
    const { data: after } = await supabase
      .from('prickle_attendance')
      .select('*')
      .eq('join_time', '2099-05-25T16:00:00+00:00')
      .single()

    expect(after).toBeNull()
  })

  it('should create attendance for inactive members (historical accuracy)', async () => {
    // Inactive members attended real meetings while they were active members.
    // Their current status must not erase that history — processing uses all members.
    const inactiveTs = Date.now()
    const inactiveMeetingUuid = `test-meeting-inactive-${inactiveTs}`

    const { data: inactiveMember } = await supabase
      .from('members')
      .insert({
        name: `Inactive Test Member ${inactiveTs}`,
        email: `inactive-test-${inactiveTs}@example.com`,
        joined_at: '2022-01-01',
        status: 'cancelled',
      })
      .select('id')
      .single()

    await supabase.schema('bronze').from('zoom_meetings').insert({
      meeting_uuid: inactiveMeetingUuid,
      meeting_id: inactiveMeetingUuid,
      topic: 'Historical Meeting',
      start_time: '2099-05-22T10:00:00Z',
      end_time: '2099-05-22T11:00:00Z',
      duration_minutes: 60,
      data: {},
    })

    await supabase.schema('bronze').from('zoom_attendees').insert({
      meeting_id: inactiveMeetingUuid,
      meeting_uuid: inactiveMeetingUuid,
      name: `Inactive Test Member ${inactiveTs}`,
      email: null,
      join_time: '2099-05-22T10:05:00Z',
      leave_time: '2099-05-22T10:55:00Z',
      duration: 50,
    })

    const response = await fetch('http://localhost:3000/api/process/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({ fromDate: testDateRange.from, toDate: testDateRange.to }),
    })

    const result = await response.json()
    expect(result.success).toBe(true)

    const { data: attendance } = await supabase
      .from('prickle_attendance')
      .select('*')
      .eq('member_id', inactiveMember!.id)

    expect(attendance).toHaveLength(1)
    expect(attendance?.[0].join_time).toBe('2099-05-22T10:05:00+00:00')

    // Clean up
    await supabase.schema('bronze').from('zoom_attendees').delete().eq('meeting_uuid', inactiveMeetingUuid)
    await supabase.schema('bronze').from('zoom_meetings').delete().eq('meeting_uuid', inactiveMeetingUuid)
    await supabase.from('members').delete().eq('id', inactiveMember!.id)
  })

  it('should only affect data in date range (scoped reprocessing)', async () => {
    // ARRANGE: Insert attendance outside the date range
    const juneMeetingUuid = `test-meeting-june-${Date.now()}`

    await supabase.schema('bronze').from('zoom_meetings').insert({
      meeting_uuid: juneMeetingUuid,
      meeting_id: juneMeetingUuid,
      topic: 'June Meeting',
      start_time: '2099-06-01T10:00:00Z',
      end_time: '2099-06-01T11:00:00Z',
      duration_minutes: 60,
      data: {},
    })

    await supabase.schema('bronze').from('zoom_attendees').insert({
      meeting_id: juneMeetingUuid,
      meeting_uuid: juneMeetingUuid,
      name: 'Reprocess Test Member',
      email: null,
      join_time: '2099-06-01T10:00:00Z',
      leave_time: '2099-06-01T11:00:00Z',
      duration: 60,
    })

    // Process June data
    await fetch('http://localhost:3000/api/process/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({
        fromDate: '2099-06-01',
        toDate: '2099-06-30',
      }),
    })

    // ACT: Process May only
    const response = await fetch('http://localhost:3000/api/process/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({
        fromDate: testDateRange.from,
        toDate: testDateRange.to,
      }),
    })

    const result = await response.json()
    expect(result.success).toBe(true)

    // ASSERT: June attendance should still exist (out of scope)
    const { data: juneAttendance } = await supabase
      .from('prickle_attendance')
      .select('*')
      .eq('member_id', testMemberId)
      .eq('join_time', '2099-06-01T10:00:00+00:00')

    expect(juneAttendance).toHaveLength(1)

    // Clean up
    await supabase.schema('bronze').from('zoom_attendees').delete().eq('meeting_uuid', juneMeetingUuid)
    await supabase.schema('bronze').from('zoom_meetings').delete().eq('meeting_uuid', juneMeetingUuid)
    await supabase.from('prickle_attendance').delete().eq('join_time', '2099-06-01T10:00:00+00:00')
  })
})
