import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { seedReferenceData } from '../../helpers/seed-data'

/**
 * /api/process/attendance writes long ranges in several atomic calls, split
 * only at quiet gaps. Splitting must not change the result: a chunked run
 * leaves exactly the attendance, PUPs (same ids) and member_activities mirror
 * that a single call does, including a meeting that crosses midnight UTC and a
 * leave/rejoin. Calls the route directly against the real local DB.
 */
vi.mock('@/lib/supabase/api-auth', () => ({ requireAdmin: vi.fn() }))

import { requireAdmin } from '@/lib/supabase/api-auth'
import { POST } from '@/app/api/process/attendance/route'

const supabase = getTestSupabaseAdminClient()
const suffix = Date.now()
const uuidPrefix = `test-chunked-${suffix}`
const RANGE = { from: '2098-03-01T00:00:00Z', to: '2098-03-05T00:00:00Z' }
const alphaName = `Chunk Test Alpha ${suffix}`
const betaName = `Chunk Test Beta ${suffix}`
let alphaId: string
let betaId: string

const sessions = [
  // Two members, plain PUP.
  { meeting: 'm1', name: alphaName, join: '2098-03-01T10:00:00Z', leave: '2098-03-01T11:00:00Z' },
  { meeting: 'm1', name: betaName, join: '2098-03-01T10:05:00Z', leave: '2098-03-01T11:00:00Z' },
  // Crosses midnight UTC.
  { meeting: 'm2', name: alphaName, join: '2098-03-02T23:30:00Z', leave: '2098-03-03T00:45:00Z' },
  { meeting: 'm2', name: betaName, join: '2098-03-02T23:35:00Z', leave: '2098-03-03T00:40:00Z' },
  // Leave and rejoin.
  { meeting: 'm3', name: betaName, join: '2098-03-04T15:00:00Z', leave: '2098-03-04T15:20:00Z' },
  { meeting: 'm3', name: betaName, join: '2098-03-04T15:40:00Z', leave: '2098-03-04T16:00:00Z' },
  { meeting: 'm3', name: alphaName, join: '2098-03-04T15:00:00Z', leave: '2098-03-04T16:00:00Z' },
]

async function process(maxRowsPerWrite?: number) {
  const response = await POST(
    new NextRequest('http://localhost/api/process/attendance', {
      method: 'POST',
      body: JSON.stringify({ fromDate: RANGE.from, toDate: RANGE.to, maxRowsPerWrite }),
    })
  )
  const body = await response.json()
  expect(response.status, JSON.stringify(body)).toBe(200)
  return body
}

async function snapshot() {
  const memberIds = [alphaId, betaId]
  const [{ data: attendance }, { data: pups }, { data: mirror }] = await Promise.all([
    supabase
      .from('prickle_attendance')
      .select('member_id, prickle_id, join_time, leave_time')
      .in('member_id', memberIds)
      .order('join_time')
      .order('member_id'),
    supabase
      .from('prickles')
      .select('id, zoom_meeting_uuid, start_time, end_time')
      .like('zoom_meeting_uuid', `${uuidPrefix}%`)
      .order('start_time'),
    supabase
      .from('member_activities')
      .select('member_id, related_id, occurred_at, duration_minutes')
      .eq('source', 'prickle_attendance')
      .in('member_id', memberIds)
      .order('occurred_at')
      .order('member_id'),
  ])
  return { attendance, pups, mirror }
}

describe('attendance processing: chunked atomic writes', () => {
  beforeAll(async () => {
    await seedReferenceData()
    vi.mocked(requireAdmin).mockResolvedValue({ user: { id: 'admin' } as any, forbidden: false, supabase } as any)

    const { data: members, error } = await supabase
      .from('members')
      .insert([
        { name: alphaName, email: `chunk-alpha-${suffix}@example.com`, joined_at: '2022-01-01', status: 'active' },
        { name: betaName, email: `chunk-beta-${suffix}@example.com`, joined_at: '2022-01-01', status: 'active' },
      ])
      .select('id, name')
    if (error) throw error
    alphaId = members!.find((m) => m.name === alphaName)!.id
    betaId = members!.find((m) => m.name === betaName)!.id

    const { error: zoomError } = await supabase.schema('bronze').from('zoom_attendees').insert(
      sessions.map((s) => ({
        meeting_id: `${uuidPrefix}-${s.meeting}`,
        meeting_uuid: `${uuidPrefix}-${s.meeting}`,
        name: s.name,
        email: null,
        join_time: s.join,
        leave_time: s.leave,
        duration: Math.round((Date.parse(s.leave) - Date.parse(s.join)) / 60000),
      }))
    )
    if (zoomError) throw zoomError
  })

  afterAll(async () => {
    await supabase.from('prickle_attendance').delete().in('member_id', [alphaId, betaId])
    await supabase.from('member_activities').delete().in('member_id', [alphaId, betaId])
    await supabase.from('prickles').delete().like('zoom_meeting_uuid', `${uuidPrefix}%`)
    await supabase.schema('bronze').from('zoom_attendees').delete().like('meeting_uuid', `${uuidPrefix}%`)
    await supabase.from('members').delete().in('id', [alphaId, betaId])
  })

  it('writes the same rows in several chunks as in one call', async () => {
    const single = await process()
    expect(single.atomicWrites).toBe(1)
    const one = await snapshot()
    expect(one.attendance!.length).toBe(sessions.length)
    expect(one.pups!.length).toBe(3)
    expect(one.mirror!.length).toBe(6) // one per member per prickle

    const chunked = await process(1)
    expect(chunked.atomicWrites).toBe(3) // one per meeting: the gaps between them
    expect(await snapshot()).toEqual(one)
  })

  it('is idempotent when chunked', async () => {
    await process(1)
    const first = await snapshot()
    await process(1)
    expect(await snapshot()).toEqual(first)
  })
})
