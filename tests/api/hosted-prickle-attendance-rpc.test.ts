import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestSupabaseClient } from '../helpers/supabase'
import { seedReferenceData } from '../helpers/seed-data'
import { fetchHostedPrickleRecords } from '@/lib/hosted-prickles'
import { computePublicHostingSummary } from '@/lib/hosting-stats'

/**
 * get_hosted_prickle_attendance (20260926000500) against the real local DB: distinct attendee
 * counts with leave/rejoin duplicates, >1000 attendance rows on one prickle (so a naive
 * PostgREST row fetch would truncate), >1000 hosted prickles (so the RPC itself must be paged),
 * future/other-host exclusion, and anon lockout.
 *
 * All fixtures are scoped to ids created here and dated in 1990-1993 to stay out of other
 * tests' date ranges; cleanup deletes only those ids.
 */
describe('get_hosted_prickle_attendance', () => {
  const admin = getTestSupabaseAdminClient()
  const ts = Date.now()
  const NOW = new Date('2000-01-01T00:00:00.000Z')

  let typeId: string
  let typeName: string
  let hostId: string
  let otherHostId: string
  const attendeeIds: string[] = []
  const prickleIds: string[] = []
  let busyPrickleId: string
  let hostlessShowPrickleId: string
  let emptyPrickleId: string

  async function insertPrickles(rows: { start: string; host: string }[]): Promise<string[]> {
    const { data, error } = await admin
      .from('prickles')
      .insert(
        rows.map((r) => ({
          type_id: typeId,
          host: r.host,
          start_time: r.start,
          end_time: new Date(new Date(r.start).getTime() + 60 * 60 * 1000).toISOString(),
          source: 'calendar',
        }))
      )
      .select('id, start_time')
    if (error) throw new Error(`prickle insert failed: ${error.message}`)
    const sorted = [...data!].sort((a, b) => a.start_time.localeCompare(b.start_time))
    const ids = sorted.map((p) => p.id as string)
    prickleIds.push(...ids)
    return ids
  }

  beforeAll(async () => {
    await seedReferenceData()
    const { data: type } = await admin.from('prickle_types').select('id, name').limit(1).single()
    typeId = type!.id
    typeName = type!.name

    const { data: members, error: memberError } = await admin
      .from('members')
      .insert(
        ['host', 'other-host', 'a1', 'a2', 'a3', 'a4'].map((tag) => ({
          name: `Hosted RPC ${tag}`,
          email: `hosted-rpc-${tag}-${ts}@example.com`,
          joined_at: '1990-01-01',
          status: 'active',
        }))
      )
      .select('id, email')
    if (memberError) throw new Error(memberError.message)
    const byTag = (tag: string) => members!.find((m) => m.email.startsWith(`hosted-rpc-${tag}-`))!.id as string
    hostId = byTag('host')
    otherHostId = byTag('other-host')
    attendeeIds.push(byTag('a1'), byTag('a2'), byTag('a3'), byTag('a4'))

    // Three hand-checked prickles in 1990...
    ;[busyPrickleId, hostlessShowPrickleId, emptyPrickleId] = await insertPrickles([
      { start: '1990-01-01T14:00:00.000Z', host: hostId },
      { start: '1990-01-08T14:00:00.000Z', host: hostId },
      { start: '1990-01-15T14:00:00.000Z', host: hostId },
    ])
    // ...998 more so the host has 1001 started prickles (> PostgREST's 1000-row page)...
    await insertPrickles(
      Array.from({ length: 998 }, (_, i) => ({
        start: new Date(Date.UTC(1991, 0, 1) + i * 24 * 60 * 60 * 1000).toISOString(),
        host: hostId,
      }))
    )
    // ...plus one in the "future" relative to NOW, and one hosted by someone else.
    await insertPrickles([
      { start: '2001-06-01T14:00:00.000Z', host: hostId },
      { start: '1990-01-01T14:00:00.000Z', host: otherHostId },
    ])

    // busy prickle: 1200 attendance rows from host + 4 attendees (constant leave/rejoin).
    // Host's earliest join is 14:01 even though they rejoin many times.
    const everyone = [hostId, ...attendeeIds]
    const base = new Date('1990-01-01T14:01:00.000Z').getTime()
    const busyRows = Array.from({ length: 1200 }, (_, i) => ({
      member_id: everyone[i % everyone.length],
      prickle_id: busyPrickleId,
      join_time: new Date(base + i * 1000).toISOString(),
      leave_time: new Date(base + i * 1000 + 500).toISOString(),
      confidence_score: 'high',
    }))
    for (let i = 0; i < busyRows.length; i += 500) {
      const { error } = await admin.from('prickle_attendance').insert(busyRows.slice(i, i + 500))
      if (error) throw new Error(`attendance insert failed: ${error.message}`)
    }

    // hostless-show prickle: one attendee joins twice, host never shows.
    const { error: e2 } = await admin.from('prickle_attendance').insert([
      {
        member_id: attendeeIds[0],
        prickle_id: hostlessShowPrickleId,
        join_time: '1990-01-08T14:00:00.000Z',
        leave_time: '1990-01-08T14:30:00.000Z',
        confidence_score: 'high',
      },
      {
        member_id: attendeeIds[0],
        prickle_id: hostlessShowPrickleId,
        join_time: '1990-01-08T14:40:00.000Z',
        leave_time: '1990-01-08T15:00:00.000Z',
        confidence_score: 'high',
      },
    ])
    if (e2) throw new Error(e2.message)
  }, 120_000)

  afterAll(async () => {
    for (let i = 0; i < prickleIds.length; i += 200) {
      const chunk = prickleIds.slice(i, i + 200)
      await admin.from('prickle_attendance').delete().in('prickle_id', chunk)
      await admin.from('prickles').delete().in('id', chunk)
    }
    const memberIds = [hostId, otherHostId, ...attendeeIds].filter(Boolean)
    if (memberIds.length > 0) await admin.from('members').delete().in('id', memberIds)
  }, 120_000)

  it('aggregates distinct attendees and the host earliest join per hosted prickle', async () => {
    const { data, error } = await admin
      .rpc('get_hosted_prickle_attendance', { p_host_id: hostId, p_started_before: NOW.toISOString() })
      .range(0, 2)
    expect(error).toBeNull()
    expect(data).toHaveLength(3)

    const [busy, hostlessShow, empty] = data!
    expect(busy).toMatchObject({
      prickle_id: busyPrickleId,
      type_name: typeName,
      attendee_count: 5, // host + 4, despite 1200 rows
    })
    expect(new Date(busy.host_earliest_join).toISOString()).toBe('1990-01-01T14:01:00.000Z')

    expect(hostlessShow).toMatchObject({ prickle_id: hostlessShowPrickleId, attendee_count: 1, host_earliest_join: null })
    expect(empty).toMatchObject({ prickle_id: emptyPrickleId, attendee_count: 0, host_earliest_join: null })
  })

  it('fetchHostedPrickleRecords pages the RPC past 1000 rows and excludes future / other-host prickles', async () => {
    const records = await fetchHostedPrickleRecords(admin as never, hostId, { now: NOW, includeAttendeeCounts: true })

    expect(records).toHaveLength(1001)
    expect(new Set(records.map((r) => r.prickleId)).size).toBe(1001)
    expect(records.every((r) => new Date(r.startTime) <= NOW)).toBe(true)

    const busy = records.find((r) => r.prickleId === busyPrickleId)!
    expect(busy.attendeeCount).toBe(5)
    expect(new Date(busy.earliestJoinTime!).toISOString()).toBe('1990-01-01T14:01:00.000Z')

    const summary = computePublicHostingSummary(records)
    expect(summary.totalHosted).toBe(1001)
    expect(summary.avgAttendance).toBeCloseTo(6 / 1001) // 5 + 1 + 0 * 999
    expect(new Date(summary.firstHostedAt!).toISOString()).toBe('1990-01-01T14:00:00.000Z')
  }, 60_000)

  it('matches the host-only path on everything but attendeeCount', async () => {
    const [aggregated, hostOnly] = await Promise.all([
      fetchHostedPrickleRecords(admin as never, hostId, { now: NOW, includeAttendeeCounts: true }),
      fetchHostedPrickleRecords(admin as never, hostId, { now: NOW }),
    ])
    const norm = (rs: typeof aggregated) =>
      rs
        .map((r) => ({
          prickleId: r.prickleId,
          typeName: r.typeName,
          startTime: new Date(r.startTime).toISOString(),
          endTime: r.endTime ? new Date(r.endTime).toISOString() : undefined,
          earliestJoinTime: r.earliestJoinTime ? new Date(r.earliestJoinTime).toISOString() : null,
        }))
        .sort((a, b) => a.prickleId.localeCompare(b.prickleId))
    expect(norm(aggregated)).toEqual(norm(hostOnly))
    expect(hostOnly[0]).not.toHaveProperty('attendeeCount')
  }, 60_000)

  it('is not executable by anon', async () => {
    const anon = getTestSupabaseClient()
    const { data, error } = await anon.rpc('get_hosted_prickle_attendance', {
      p_host_id: hostId,
      p_started_before: NOW.toISOString(),
    })
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })
})
