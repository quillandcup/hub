import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'

/**
 * Integration tests for GET /api/analyze/zoom-access
 *
 * Returns one list:
 *   matched_inactive — attendees matched to an inactive member
 *
 * Note: this route used to also return `unmatched` (attendees with no member
 * match at all), but that was intentionally removed in "Consolidate data
 * hygiene and reconciliation into one dashboard" — unmatched-name detection
 * now lives at /admin/hygiene/unmatched-zoom instead (all-time, not just the
 * last 90 days), so it isn't duplicated here. The tests covering that
 * removed behavior were deleted along with it rather than left pointing at
 * a dead field.
 */
describe('Zoom Access', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()
  const base = getTestApiBaseUrl()

  const recentJoin = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days ago
  const oldJoin = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString() // 100 days ago (outside 90-day window)

  const names = {
    activeMember: `ZoomAccessActive ${ts}`,
    inactiveMember: `ZoomAccessInactive ${ts}`,
    oldAttendee: `ZoomAccessOld ${ts}`,
  }

  const meetingUuid = `zoom-access-meeting-${ts}`

  let activeMemberId: string
  let inactiveMemberId: string

  beforeAll(async () => {
    // Members
    const { data: active } = await supabase.from('members').insert({
      name: names.activeMember,
      email: `zoom-access-active-${ts}@example.com`,
      joined_at: new Date().toISOString(),
      status: 'active',
    }).select('id').single()
    activeMemberId = active!.id

    const { data: inactive } = await supabase.from('members').insert({
      name: names.inactiveMember,
      email: `zoom-access-inactive-${ts}@example.com`,
      joined_at: new Date().toISOString(),
      status: 'cancelled',
    }).select('id').single()
    inactiveMemberId = inactive!.id

    // Zoom attendees (recent)
    await supabase.schema('bronze').from('zoom_attendees').insert([
      // Active member attending — should NOT appear
      { name: names.activeMember, email: null, meeting_id: meetingUuid, meeting_uuid: meetingUuid, join_time: recentJoin, leave_time: recentJoin, duration: 0 },
      // Inactive member attending — should appear in matched_inactive
      { name: names.inactiveMember, email: null, meeting_id: meetingUuid, meeting_uuid: meetingUuid, join_time: recentJoin, leave_time: recentJoin, duration: 0 },
      // Old attendance — should NOT appear (outside 90-day window)
      { name: names.inactiveMember, email: null, meeting_id: `${meetingUuid}-old`, meeting_uuid: `${meetingUuid}-old`, join_time: oldJoin, leave_time: oldJoin, duration: 0 },
    ])
  })

  afterAll(async () => {
    await supabase.schema('bronze').from('zoom_attendees')
      .delete().ilike('meeting_uuid', `${meetingUuid}%`)
    await supabase.from('members').delete().in('id', [activeMemberId, inactiveMemberId])
  })

  async function fetchZoomAccess() {
    const response = await fetch(`${base}/api/analyze/zoom-access`, { headers: getTestAuthHeaders() })
    const body = await response.json()
    expect(response.ok, `API returned ${response.status}: ${JSON.stringify(body)}`).toBe(true)
    return body as { matched_inactive: any[] }
  }

  it('includes inactive member with recent attendance in matched_inactive', async () => {
    const { matched_inactive } = await fetchZoomAccess()
    expect(matched_inactive.some((m: any) => m.member_id === inactiveMemberId)).toBe(true)
  })

  it('does not include active members in matched_inactive', async () => {
    const { matched_inactive } = await fetchZoomAccess()
    expect(matched_inactive.some((m: any) => m.member_id === activeMemberId)).toBe(false)
  })

  it('excludes attendance older than 90 days', async () => {
    // The old attendee record for inactiveMember should NOT inflate the prickle_count
    // (it's also a different meeting_uuid so won't be counted)
    const { matched_inactive } = await fetchZoomAccess()
    const entry = matched_inactive.find((m: any) => m.member_id === inactiveMemberId)
    // Only 1 recent meeting, not the old one
    expect(entry?.prickle_count).toBe(1)
  })
})
