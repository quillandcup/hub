import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'
import { seedReferenceData } from '../../helpers/seed-data'
import { apiFetch } from '../../helpers/api-fetch'
import { SupabaseZoomRepository } from '@/lib/data/zoom'
import type { Db } from '@/lib/data/db'

/**
 * Meetings from a Zoom account that is excluded by default stay in Bronze but reach Silver only once an
 * admin keeps them. Silver is fully reprocessable, so: an excluded meeting makes no prickle and no
 * attendance, keeping it creates them on the next run, and ignoring a kept meeting removes them again.
 */
describe('Zoom account decisions and attendance reprocessing', () => {
  const supabase = getTestSupabaseAdminClient()
  const zoom = new SupabaseZoomRepository(supabase as unknown as Db)
  const range = { from: '2099-07-01', to: '2099-07-31' }
  const RUN = `${Date.now()}`
  const meetingUuid = `test-zacc-${RUN}`
  const meetingId = `zacc-mid-${RUN}`
  const memberName = `Zoom Account Test ${RUN}`

  let memberId: string
  let accountId: string

  const processAttendance = async () => {
    const response = await apiFetch(`${getTestApiBaseUrl()}/api/process/attendance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
      body: JSON.stringify({ fromDate: range.from, toDate: range.to }),
    })
    const body = await response.json()
    expect(body.success).toBe(true)
  }
  const pups = async () =>
    (await supabase.from('prickles').select('id').eq('source', 'zoom').eq('zoom_meeting_uuid', meetingUuid)).data ?? []
  const attendance = async () =>
    (await supabase.from('prickle_attendance').select('id').eq('member_id', memberId)).data ?? []

  const cleanRange = async () => {
    await supabase.from('prickle_attendance').delete().lt('join_time', '2099-08-01T00:00:00Z').gt('leave_time', `${range.from}T00:00:00Z`)
    await supabase.from('prickles').delete().eq('source', 'zoom').lt('start_time', '2099-08-01T00:00:00Z').gt('end_time', `${range.from}T00:00:00Z`)
    await supabase.schema('bronze').from('zoom_attendees').delete().eq('meeting_uuid', meetingUuid)
    await supabase.schema('bronze').from('zoom_meetings').delete().eq('meeting_uuid', meetingUuid)
  }

  beforeAll(async () => {
    await seedReferenceData()
    await cleanRange()
    const { data: member } = await supabase
      .from('members')
      .insert({ name: memberName, email: `zacc-${RUN}@example.com`, joined_at: '2022-01-01', status: 'active' })
      .select('id')
      .single()
    memberId = member!.id
    accountId = (
      await zoom.createAccount({ slug: `zacc-test-${RUN}`, label: 'Second', hostEmail: null, defaultPolicy: 'exclude', credentialsPrefix: `ZACCTEST_${RUN}` })
    ).id

    await zoom.upsertMeeting({
      zoom_account: accountId,
      meeting_uuid: meetingUuid,
      meeting_id: meetingId,
      topic: 'Not a community session',
      start_time: '2099-07-15T10:00:00Z',
      end_time: '2099-07-15T11:00:00Z',
      duration_minutes: 60,
      data: {},
    })
    await zoom.upsertAttendees([
      {
        zoom_account: accountId,
        meeting_id: meetingId,
        meeting_uuid: meetingUuid,
        name: memberName,
        email: null,
        join_time: '2099-07-15T10:05:00Z',
        leave_time: '2099-07-15T10:55:00Z',
        duration: 50,
      },
    ])
  })

  afterAll(async () => {
    await supabase.from('prickle_attendance').delete().eq('member_id', memberId)
    await supabase.from('member_activities').delete().eq('member_id', memberId)
    await cleanRange()
    await supabase.from('zoom_accounts').delete().eq('id', accountId)
    await supabase.from('members').delete().eq('id', memberId)
  })

  it('makes no prickle and no attendance for a meeting nobody has kept', async () => {
    await processAttendance()

    expect(await pups()).toHaveLength(0)
    expect(await attendance()).toHaveLength(0)
    // Bronze keeps everything
    expect(await zoom.attendeeCount()).toBeGreaterThan(0)
    expect((await zoom.reviewMeetings()).find((m) => m.meetingUuid === meetingUuid)?.state).toBe('undecided')
  })

  it('creates the prickle and attendance once the meeting is kept', async () => {
    await zoom.setDecision({ zoomAccount: accountId, scope: 'instance', zoomKey: meetingUuid, decision: 'kept', decidedBy: null })
    await processAttendance()

    expect(await pups()).toHaveLength(1)
    expect(await attendance()).toHaveLength(1)
  })

  it('keeps the same prickle id when the kept meeting is processed again', async () => {
    const before = await pups()
    await processAttendance()

    expect((await pups()).map((p) => p.id)).toEqual(before.map((p) => p.id))
    expect(await attendance()).toHaveLength(1)
  })

  it('removes the prickle and attendance again when the kept meeting is ignored', async () => {
    await zoom.setDecision({ zoomAccount: accountId, scope: 'instance', zoomKey: meetingUuid, decision: 'ignored', decidedBy: null })
    await processAttendance()

    expect(await pups()).toHaveLength(0)
    expect(await attendance()).toHaveLength(0)
  })

  it('creates them again when every occurrence of the link is kept, and the instance decision is taken back', async () => {
    await zoom.setDecision({ zoomAccount: accountId, scope: 'series', zoomKey: meetingId, decision: 'kept', decidedBy: null })
    await zoom.clearDecision({ zoomAccount: accountId, scope: 'instance', zoomKey: meetingUuid })
    await processAttendance()

    expect(await pups()).toHaveLength(1)
    expect(await attendance()).toHaveLength(1)
  })
})
