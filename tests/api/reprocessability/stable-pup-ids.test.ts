import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'
import { seedReferenceData } from '../../helpers/seed-data'
import { apiFetch } from '../../helpers/api-fetch'

/**
 * REGRESSION TEST: a Pop-Up Prickle keeps its id when only its end moves.
 *
 * BUG CONTEXT:
 * - A PUP was keyed on (zoom_meeting_uuid, start_time, end_time). A run that computed a different
 *   end deleted the row and inserted a new one: a new id, and the old one's check-ins, dismissals,
 *   DM log and attendance cascaded away (docs/TODO.md, "Pop-Up Prickle ids change...").
 * - Fix: reprocess_prickle_attendance_atomic moves the end of the row with the same meeting and
 *   start in place (migration 20270512000000_stable_pup_ids.sql).
 *
 * The room: one meeting with no scheduled prickle, so the PUP is the whole meeting. Its end then
 * moves because a calendar prickle gets added inside it later, and because a late joiner is
 * added after it.
 */
describe('Stable Pop-Up Prickle ids', () => {
  const supabase = getTestSupabaseAdminClient()
  const stamp = Date.now()
  const meetingUuid = `test-stable-pup-${stamp}`
  const names = { first: `Stable First ${stamp}`, second: `Stable Second ${stamp}` }

  const memberIds: Record<string, string> = {}
  let calendarPrickleId: string | null = null

  const process = async () => {
    const response = await apiFetch(`${getTestApiBaseUrl()}/api/process/attendance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({ fromDate: '2097-04-10', toDate: '2097-04-10' }),
    })
    const result = await response.json()
    expect(result.success, JSON.stringify(result)).toBe(true)
  }

  const pups = async () => {
    const { data } = await supabase.from('prickles').select('id, start_time, end_time').eq('source', 'zoom').eq('zoom_meeting_uuid', meetingUuid)
    return (data ?? []).map((p) => ({ id: p.id, start: new Date(p.start_time).toISOString(), end: new Date(p.end_time).toISOString() }))
  }

  const rowsFor = async (table: string, prickleId: string) => {
    const { data } = await supabase.from(table).select('*').eq('prickle_id', prickleId)
    return data ?? []
  }

  const attendee = (name: string, join: string, leave: string) => ({
    meeting_id: meetingUuid,
    meeting_uuid: meetingUuid,
    name,
    email: null,
    join_time: join,
    leave_time: leave,
    duration: Math.round((new Date(leave).getTime() - new Date(join).getTime()) / 60000),
  })

  beforeAll(async () => {
    await seedReferenceData()
    for (const [key, name] of Object.entries(names)) {
      const { data } = await supabase
        .from('members')
        .insert({ name, email: `${key}-stable-${stamp}@example.com`, joined_at: '2022-01-01', status: 'active' })
        .select('id')
        .single()
      memberIds[key] = data!.id
    }
    // The meeting, with no scheduled prickle: the PUP is all of it, 10:00 to 11:00.
    await supabase.schema('bronze').from('zoom_attendees').insert(attendee(names.first, '2097-04-10T10:00:00Z', '2097-04-10T11:00:00Z'))
  })

  afterAll(async () => {
    const ids = (await pups()).map((p) => p.id)
    if (calendarPrickleId) ids.push(calendarPrickleId)
    for (const table of ['prickle_checkins', 'prickle_checkin_dm_log', 'prickle_attendance'] as const) {
      if (ids.length) await supabase.from(table).delete().in('prickle_id', ids)
    }
    await supabase.from('prickles').delete().eq('source', 'zoom').eq('zoom_meeting_uuid', meetingUuid)
    if (calendarPrickleId) await supabase.from('prickles').delete().eq('id', calendarPrickleId)
    await supabase.schema('bronze').from('zoom_attendees').delete().eq('meeting_uuid', meetingUuid)
    await supabase.from('members').delete().in('id', Object.values(memberIds))
  })

  it('keeps the id, the check-in and the DM log when a calendar prickle added inside the meeting moves the end back', async () => {
    await process()
    const [created] = await pups()
    expect(created.end).toBe('2097-04-10T11:00:00.000Z')

    // What hangs off the PUP: a saved check-in and the log of the DM sent for it.
    await supabase.from('prickle_checkins').insert({ member_id: memberIds.first, prickle_id: created.id, need: 'company' })
    await supabase.from('prickle_checkin_dm_log').insert({ member_id: memberIds.first, prickle_id: created.id, kind: 'prickle_checkout' })

    // The calendar item for 10:30 to 11:00 arrives late: the PUP now stops where the scheduled prickle starts.
    const { data: type } = await supabase.from('prickle_types').select('id').eq('name', 'Progress Prickle').single()
    const { data: calendar } = await supabase
      .from('prickles')
      .insert({ type_id: type!.id, start_time: '2097-04-10T10:30:00Z', end_time: '2097-04-10T11:00:00Z', source: 'calendar' })
      .select('id')
      .single()
    calendarPrickleId = calendar!.id
    await process()

    const after = await pups()
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe(created.id)
    expect(after[0].end).toBe('2097-04-10T10:30:00.000Z')
    expect(await rowsFor('prickle_checkins', created.id)).toHaveLength(1)
    expect(await rowsFor('prickle_checkin_dm_log', created.id)).toHaveLength(1)
    // And the attendance was rebuilt against it, not lost.
    expect((await rowsFor('prickle_attendance', created.id)).length).toBeGreaterThan(0)
  })

  it('keeps the id when a late joiner added later moves the end out again, and when the calendar prickle goes', async () => {
    const [before] = await pups()
    await supabase.from('prickles').delete().eq('id', calendarPrickleId!)
    calendarPrickleId = null
    await supabase.schema('bronze').from('zoom_attendees').insert(attendee(names.second, '2097-04-10T10:20:00Z', '2097-04-10T12:00:00Z'))
    await process()

    const after = await pups()
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe(before.id)
    expect(after[0].end).toBe('2097-04-10T12:00:00.000Z')
    expect(await rowsFor('prickle_checkins', before.id)).toHaveLength(1)
    expect(await rowsFor('prickle_checkin_dm_log', before.id)).toHaveLength(1)
  })

  it('leaves the row alone when processed again with nothing changed', async () => {
    const [row] = await pups()
    await process()

    expect(await pups()).toEqual([row])
  })
})
