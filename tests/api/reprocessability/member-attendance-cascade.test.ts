import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders } from '../../helpers/supabase'
import { seedReferenceData } from '../../helpers/seed-data'

/**
 * Verifies the invariant that makes "matched → no attendance record" an impossible
 * steady state: when a member is added and attendance is reprocessed, their
 * historical Zoom records become prickle_attendance records.
 *
 * The gap scenario:
 *   1. Zoom data arrives for "New Member Name"
 *   2. "New Member" is not yet in the members table
 *   3. Attendance processing runs → no match → no record
 *   4. "New Member" is added to members table
 *   5. /api/process/members triggers attendance reprocessing via after()
 *   6. Attendance processing reruns → matches "New Member" → record created
 *
 * This file tests steps 3–6, verifying the cascade closes the gap.
 * The code wiring (step 5) is verified by tests/api/process-members-trigger.test.ts.
 */
describe('Member → Attendance cascade', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()
  const testDateRange = { from: '2099-07-01', to: '2099-07-31' }
  const meetingUuid = `cascade-test-${ts}`
  const memberName = `Cascade Test Member ${ts}`
  const memberEmail = `cascade-${ts}@example.com`

  let memberId: string

  beforeAll(async () => {
    await seedReferenceData()

    // Clean up any leftover test data (broad bronze sweep + specific meeting)
    await supabase.from('prickle_attendance').delete()
      .lt('join_time', '2099-08-01T00:00:00Z').gt('leave_time', '2099-07-01T00:00:00Z')
    await supabase.from('prickles').delete().eq('source', 'zoom')
      .lt('start_time', '2099-08-01T00:00:00Z').gt('end_time', '2099-07-01T00:00:00Z')
    // Delete all bronze zoom data in the 2099-07 range to prevent leftover cascade-alias records
    // from previous failed runs from creating spurious attendance records
    await supabase.schema('bronze').from('zoom_attendees').delete()
      .lt('join_time', '2099-08-01T00:00:00Z').gt('join_time', '2099-07-01T00:00:00Z')
    await supabase.schema('bronze').from('zoom_meetings').delete()
      .lt('start_time', '2099-08-01T00:00:00Z').gt('start_time', '2099-07-01T00:00:00Z')
    // Clean up any alias members left from prior failed runs
    await supabase.from('member_name_aliases').delete().ilike('alias', 'Alias Gap Test%')
    await supabase.from('members').delete().ilike('name', 'Alias Member%')
    await supabase.from('members').delete().eq('email', memberEmail)

    // Insert a Zoom meeting with one attendee whose member record does not exist yet
    await supabase.schema('bronze').from('zoom_meetings').insert({
      meeting_uuid: meetingUuid,
      meeting_id: meetingUuid,
      topic: 'Cascade Test Meeting',
      start_time: '2099-07-15T10:00:00Z',
      end_time: '2099-07-15T11:00:00Z',
      duration_minutes: 60,
      data: {},
    })

    await supabase.schema('bronze').from('zoom_attendees').insert({
      meeting_id: meetingUuid,
      meeting_uuid: meetingUuid,
      name: memberName,
      email: null,
      join_time: '2099-07-15T10:05:00Z',
      leave_time: '2099-07-15T10:55:00Z',
      duration: 50,
    })
  })

  afterAll(async () => {
    if (memberId) {
      await supabase.from('prickle_attendance').delete().eq('member_id', memberId)
      await supabase.from('members').delete().eq('id', memberId)
    }
    await supabase.schema('bronze').from('zoom_attendees').delete().eq('meeting_uuid', meetingUuid)
    await supabase.schema('bronze').from('zoom_meetings').delete().eq('meeting_uuid', meetingUuid)
    await supabase.from('prickles').delete().eq('source', 'zoom')
      .lt('start_time', '2099-08-01T00:00:00Z').gt('end_time', '2099-07-01T00:00:00Z')
  })

  it('produces no attendance when the member does not yet exist', async () => {
    // Simulate: Zoom data arrives, member not in DB, attendance processing runs.
    // The Zoom name has no member to match → skipped.
    const response = await fetch('http://localhost:3000/api/process/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({ fromDate: testDateRange.from, toDate: testDateRange.to }),
    })

    const result = await response.json()
    expect(result.success).toBe(true)

    // No member exists → name is unmatched → no attendance records
    const { data: attendance } = await supabase
      .from('prickle_attendance')
      .select('id')
      .lt('join_time', '2099-08-01T00:00:00Z')
      .gt('leave_time', '2099-07-01T00:00:00Z')

    expect(attendance).toHaveLength(0)
  })

  it('creates attendance records after member is added and attendance is reprocessed', async () => {
    // Member is added (simulates what member processing does after Kajabi import)
    const { data: newMember } = await supabase
      .from('members')
      .insert({
        name: memberName,
        email: memberEmail,
        joined_at: '2022-01-01',
        status: 'active',
      })
      .select('id')
      .single()

    expect(newMember).toBeTruthy()
    memberId = newMember!.id

    // Reprocess attendance — this is what after() in /api/process/members triggers
    const response = await fetch('http://localhost:3000/api/process/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({ fromDate: testDateRange.from, toDate: testDateRange.to }),
    })

    const result = await response.json()
    expect(result.success).toBe(true)
    expect(result.attendanceRecords).toBeGreaterThan(0)

    // Member now matches → attendance record created
    const { data: attendance } = await supabase
      .from('prickle_attendance')
      .select('join_time, leave_time')
      .eq('member_id', memberId)

    expect(attendance).toHaveLength(1)
    expect(attendance?.[0].join_time).toBe('2099-07-15T10:05:00+00:00')
    expect(attendance?.[0].leave_time).toBe('2099-07-15T10:55:00+00:00')
  })

  it('is idempotent: reprocessing again does not duplicate attendance', async () => {
    const response = await fetch('http://localhost:3000/api/process/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({ fromDate: testDateRange.from, toDate: testDateRange.to }),
    })

    expect((await response.json()).success).toBe(true)

    const { data: attendance } = await supabase
      .from('prickle_attendance')
      .select('id')
      .eq('member_id', memberId)

    // DELETE + INSERT is idempotent — still exactly one record
    expect(attendance).toHaveLength(1)
  })

  it('alias-triggered reprocessing also closes the gap', async () => {
    // Verify the other trigger path: adding an alias for a Zoom name
    // causes attendance reprocessing via /api/aliases.
    // Setup: new unmatched attendee name, no member, no alias yet
    const aliasMeetingUuid = `cascade-alias-${ts}`
    const aliasName = `Alias Gap Test ${ts}`
    const aliasMember = { name: `Alias Member ${ts}`, email: `alias-${ts}@example.com` }

    const { data: aliasMemberRow } = await supabase
      .from('members')
      .insert({ ...aliasMember, joined_at: '2022-01-01', status: 'active' })
      .select('id')
      .single()

    await supabase.schema('bronze').from('zoom_meetings').insert({
      meeting_uuid: aliasMeetingUuid,
      meeting_id: aliasMeetingUuid,
      topic: 'Alias Gap Test',
      start_time: '2099-07-20T10:00:00Z',
      end_time: '2099-07-20T11:00:00Z',
      duration_minutes: 60,
      data: {},
    })
    await supabase.schema('bronze').from('zoom_attendees').insert({
      meeting_id: aliasMeetingUuid,
      meeting_uuid: aliasMeetingUuid,
      name: aliasName,        // Different from member name — will need alias
      email: null,
      join_time: '2099-07-20T10:05:00Z',
      leave_time: '2099-07-20T10:55:00Z',
      duration: 50,
    })

    // Process attendance without alias → no match for aliasName
    await fetch('http://localhost:3000/api/process/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({ fromDate: testDateRange.from, toDate: testDateRange.to }),
    })

    const { data: beforeAlias } = await supabase
      .from('prickle_attendance')
      .select('id')
      .eq('member_id', aliasMemberRow!.id)

    expect(beforeAlias).toHaveLength(0)

    // Save alias linking the Zoom name to the member — this triggers reprocessing
    // The /api/aliases route calls triggerReprocessing which runs the full cascade
    // (members → calendar → attendance) for the last 90 days.
    // Because 2099 dates are outside "last 90 days", we verify the mechanism
    // by calling attendance directly after the alias is saved (same effect).
    await supabase.from('member_name_aliases').insert({
      member_id: aliasMemberRow!.id,
      alias: aliasName,
      source: 'zoom',
    })

    // Reprocess attendance (simulates what alias-save cascade does)
    await fetch('http://localhost:3000/api/process/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({ fromDate: testDateRange.from, toDate: testDateRange.to }),
    })

    const { data: afterAlias } = await supabase
      .from('prickle_attendance')
      .select('join_time')
      .eq('member_id', aliasMemberRow!.id)

    expect(afterAlias).toHaveLength(1)
    expect(afterAlias?.[0].join_time).toBe('2099-07-20T10:05:00+00:00')

    // Clean up alias test data
    await supabase.from('member_name_aliases').delete().eq('alias', aliasName)
    await supabase.from('prickle_attendance').delete().eq('member_id', aliasMemberRow!.id)
    await supabase.from('members').delete().eq('id', aliasMemberRow!.id)
    await supabase.schema('bronze').from('zoom_attendees').delete().eq('meeting_uuid', aliasMeetingUuid)
    await supabase.schema('bronze').from('zoom_meetings').delete().eq('meeting_uuid', aliasMeetingUuid)
  })
})
