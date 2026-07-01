import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'
import { seedReferenceData } from '../../helpers/seed-data'

/**
 * After merging two member accounts, attendance reprocessing must use the
 * member_email_aliases table so that Zoom sessions recorded under the secondary
 * email continue to match the primary member.
 *
 * The merge creates an email alias (secondary → primary) and deletes the
 * secondary member. Without the alias lookup in member-matching, reprocessing
 * would orphan any attendance where the attendee's Zoom email was the secondary.
 */
describe('Attendance reprocessing after member merge', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()
  const primaryEmail = `merge-primary-${ts}@example.com`
  const secondaryEmail = `merge-secondary-${ts}@example.com`
  const testDateRange = { from: '2099-06-01', to: '2099-06-30' }
  const meetingUuid = `merge-test-meeting-${ts}`

  let primaryMemberId: string

  async function processAttendance() {
    const response = await fetch(`${getTestApiBaseUrl()}/api/process/attendance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({ fromDate: testDateRange.from, toDate: testDateRange.to }),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Process attendance failed: ${response.status} - ${text}`)
    }
    return response.json()
  }

  async function cleanUp() {
    await supabase.from('prickle_attendance').delete().ilike('prickle_id', '%').in('member_id', [primaryMemberId].filter(Boolean))
    await supabase.from('prickles').delete().eq('source', 'zoom').ilike('zoom_meeting_uuid', `merge-test-meeting-${ts}`)
    await supabase.schema('bronze').from('zoom_attendees').delete().eq('meeting_uuid', meetingUuid)
    await supabase.schema('bronze').from('zoom_meetings').delete().eq('uuid', meetingUuid)
    await supabase.from('member_email_aliases').delete().eq('alias_email', secondaryEmail)
    await supabase.from('members').delete().ilike('email', `merge-%${ts}@example.com`)
  }

  beforeAll(async () => {
    await seedReferenceData()
    await cleanUp()

    const { data: member } = await supabase
      .from('members')
      .insert({ name: 'Merge Test Primary', email: primaryEmail, joined_at: '2022-01-01', status: 'active' })
      .select('id')
      .single()

    primaryMemberId = member!.id

    // Simulate the state after a merge: secondary member is gone, email alias points to primary
    await supabase.from('member_email_aliases').insert({
      alias_email: secondaryEmail,
      canonical_email: primaryEmail,
      source: 'manual',
    })

    // Seed zoom data where attendee joined with the secondary (merged-away) email
    await supabase.schema('bronze').from('zoom_meetings').insert({
      uuid: meetingUuid,
      meeting_id: meetingUuid,
      topic: 'Test Writing Session',
      start_time: '2099-06-15T10:00:00Z',
      end_time: '2099-06-15T11:00:00Z',
      duration_minutes: 60,
      data: {},
    })

    await supabase.schema('bronze').from('zoom_attendees').insert({
      meeting_uuid: meetingUuid,
      meeting_id: meetingUuid,
      name: 'Merge Test Primary',
      email: secondaryEmail,
      join_time: '2099-06-15T10:05:00Z',
      leave_time: '2099-06-15T10:55:00Z',
      duration: 50,
    })
  })

  afterAll(cleanUp)

  it('matches attendee to primary member via email alias on first process', async () => {
    const result = await processAttendance()
    expect(result.success).toBe(true)

    const { data: attendance } = await supabase
      .from('prickle_attendance')
      .select('member_id')
      .eq('member_id', primaryMemberId)

    expect(attendance).not.toHaveLength(0)
  }, 30000)

  it('re-matches to primary via email alias on reprocess (not lost by DELETE+INSERT)', async () => {
    // Reprocessing deletes and reinserts — without email alias lookup the record would vanish
    const result = await processAttendance()
    expect(result.success).toBe(true)

    const { data: attendance } = await supabase
      .from('prickle_attendance')
      .select('member_id')
      .eq('member_id', primaryMemberId)

    expect(attendance).not.toHaveLength(0)
  }, 30000)
})
