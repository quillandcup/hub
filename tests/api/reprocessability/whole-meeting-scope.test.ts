import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'
import { seedReferenceData } from '../../helpers/seed-data'
import { apiFetch } from '../../helpers/api-fetch'

/**
 * REGRESSION TEST: a meeting is processed whole, whatever range the run was asked for.
 *
 * BUG CONTEXT:
 * - The Zoom webhook and the nightly reconcile reprocess attendance for a UTC date range that ends at
 *   00:00Z (19:00 Eastern in winter). Attendance read only the rows overlapping that range, and the
 *   calendar prickles overlapping it, so a room that crossed the cut-off showed up without its late
 *   joiners and without the prickle that starts at the cut-off: it was built as one whole-meeting
 *   Pop-Up Prickle. A run with a full range then replaced it with the right one (a new id), and
 *   every swap sent the same check-out again and cascaded the saved answers away.
 * - Fix: loadWholeMeetings reads every meeting that overlaps the range whole and widens the range
 *   to cover them, so any range gives the result of a full run.
 *
 * The room: a Pop-Up Prickle, then a scheduled Progress prickle starting exactly at the cut-off
 * (00:00Z), then a Sprint prickle. Three members: one leaves early, one stays to the end, and one
 * joins after the cut-off.
 */
describe('Whole-meeting scope', () => {
  const supabase = getTestSupabaseAdminClient()
  const stamp = Date.now()
  const meetingUuid = `test-whole-meeting-${stamp}`
  const names = { early: `Scope Early ${stamp}`, stayer: `Scope Stayer ${stamp}`, late: `Scope Late ${stamp}` }

  // 2098-03-10 22:59:31Z to 2098-03-11 02:00:36Z: crosses midnight UTC.
  const window = { from: '2098-03-10T00:00:00Z', to: '2098-03-12T00:00:00Z' }
  const cutoff = '2098-03-11T00:00:00.000Z'

  const memberIds: Record<string, string> = {}
  const calendarIds: string[] = []

  const post = async (body: Record<string, string>) => {
    const response = await apiFetch(`${getTestApiBaseUrl()}/api/process/attendance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify(body),
    })
    const result = await response.json()
    expect(result.success, JSON.stringify(result)).toBe(true)
    return result
  }

  const pups = async () => {
    const { data } = await supabase.from('prickles').select('id, start_time, end_time').eq('source', 'zoom').eq('zoom_meeting_uuid', meetingUuid)
    return data ?? []
  }

  /** member -> the prickles they have attendance for ("pup", "progress" or "sprint"), sorted. */
  const attendedBy = async () => {
    const pupIds = new Set((await pups()).map((p) => p.id))
    const out: Record<string, string[]> = {}
    for (const [key, id] of Object.entries(memberIds)) {
      const { data } = await supabase.from('prickle_attendance').select('prickle_id').eq('member_id', id)
      out[key] = (data ?? [])
        .map((a) => (pupIds.has(a.prickle_id) ? 'pup' : a.prickle_id === calendarIds[0] ? 'progress' : a.prickle_id === calendarIds[1] ? 'sprint' : 'other'))
        .sort()
    }
    return out
  }

  const cleanUp = async () => {
    await supabase.from('prickle_attendance').delete().lt('join_time', window.to).gt('leave_time', window.from)
    await supabase.from('prickles').delete().eq('source', 'zoom').eq('zoom_meeting_uuid', meetingUuid)
    if (calendarIds.length) await supabase.from('prickles').delete().in('id', calendarIds)
    await supabase.schema('bronze').from('zoom_attendees').delete().eq('meeting_uuid', meetingUuid)
    await supabase.from('members').delete().in('id', Object.values(memberIds))
  }

  beforeAll(async () => {
    await seedReferenceData()

    for (const [key, name] of Object.entries(names)) {
      const { data } = await supabase
        .from('members')
        .insert({ name, email: `${key}-${stamp}@example.com`, joined_at: '2022-01-01', status: 'active' })
        .select('id')
        .single()
      memberIds[key] = data!.id
    }

    const { data: progressType } = await supabase.from('prickle_types').select('id').eq('name', 'Progress Prickle').single()
    const { data: calendar } = await supabase
      .from('prickles')
      .insert([
        { type_id: progressType!.id, start_time: '2098-03-11T00:00:00Z', end_time: '2098-03-11T01:00:00Z', source: 'calendar' },
        { type_id: progressType!.id, start_time: '2098-03-11T01:00:00Z', end_time: '2098-03-11T02:00:00Z', source: 'calendar' },
      ])
      .select('id, start_time')
    calendarIds.push(...calendar!.sort((a, b) => a.start_time.localeCompare(b.start_time)).map((p) => p.id))

    const row = (name: string, join: string, leave: string) => ({
      meeting_id: meetingUuid,
      meeting_uuid: meetingUuid,
      name,
      email: null,
      join_time: join,
      leave_time: leave,
      duration: Math.round((new Date(leave).getTime() - new Date(join).getTime()) / 60000),
    })
    await supabase.schema('bronze').from('zoom_attendees').insert([
      row(names.early, '2098-03-10T22:59:31Z', '2098-03-11T00:21:32Z'),
      row(names.stayer, '2098-03-10T23:30:00Z', '2098-03-11T02:00:36Z'),
      row(names.late, '2098-03-11T01:05:00Z', '2098-03-11T02:00:30Z'),
    ])
  })

  afterAll(cleanUp)

  it('builds the same Pop-Up Prickle and attendance from a range cut at midnight UTC as from a full range', async () => {
    // The run the webhook and the nightly reconcile did: it stops where the Progress prickle starts.
    await post({ fromDate: '2098-03-01T00:00:00.000Z', toDate: cutoff })
    const cut = { pups: await pups(), attended: await attendedBy() }

    await post({ fromDate: '2098-03-01T00:00:00.000Z', toDate: '2098-03-20T00:00:00.000Z' })
    const full = { pups: await pups(), attended: await attendedBy() }

    // One Pop-Up Prickle, before the first scheduled prickle, not the whole meeting; same row either way.
    expect(full.pups).toHaveLength(1)
    expect(new Date(full.pups[0].start_time).toISOString()).toBe('2098-03-10T22:59:31.000Z')
    expect(new Date(full.pups[0].end_time).toISOString()).toBe(cutoff)
    expect(cut.pups).toEqual(full.pups)
    expect(cut.attended).toEqual(full.attended)

    // Nobody lost: the member who joined after the cut-off has their Sprint attendance.
    expect(full.attended.late).toEqual(['sprint'])
    expect(full.attended.stayer).toEqual(['progress', 'pup', 'sprint'])
    expect(full.attended.early).toEqual(['progress', 'pup'])
  })

  it('keeps the Pop-Up Prickle id when a zero-width range at the cut-off processes the room again', async () => {
    const [before] = await pups()
    await post({ fromDate: cutoff, toDate: cutoff })
    const after = await pups()

    expect(after).toHaveLength(1)
    expect(after[0].id).toBe(before.id)
    expect(new Date(after[0].end_time).toISOString()).toBe(cutoff)
    expect((await attendedBy()).late).toEqual(['sprint'])
  })

  it('keeps it when the run is a single date naming the day the meeting ends', async () => {
    const [before] = await pups()
    await post({ fromDate: '2098-03-11', toDate: '2098-03-11' })
    const after = await pups()

    expect(after.map((p) => p.id)).toEqual([before.id])
    expect((await attendedBy()).stayer).toEqual(['progress', 'pup', 'sprint'])
  })

  it('rebuilds the whole room from a run whose range covers only its first hour', async () => {
    // The range ends an hour after the first person joined, long before the room's late joiners and the Sprint prickle.
    const [before] = await pups()
    await post({ fromDate: '2098-03-10T22:00:00.000Z', toDate: '2098-03-10T23:00:00.000Z' })

    const after = await pups()
    expect(after.map((p) => p.id)).toEqual([before.id])
    expect(new Date(after[0].end_time).toISOString()).toBe(cutoff)
    expect((await attendedBy()).late).toEqual(['sprint'])
  })
})
