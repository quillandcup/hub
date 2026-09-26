import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { fetchUpcomingEducationalPrickles } from '@/lib/educational-prickles'

/**
 * DB integration test for the Events page's educational-prickles query
 * (lib/educational-prickles.ts, called from app/(member)/events/page.tsx).
 *
 * Runs against an isolated far-future window (year 2185) with uniquely named
 * fixtures, and asserts only on the rows it created -- other tests may be
 * writing to the same local DB concurrently.
 */
describe('fetchUpcomingEducationalPrickles', () => {
  const supabase = getTestSupabaseAdminClient()
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const now = new Date('2185-01-15T12:00:00.000Z')
  const HOUR = 60 * 60 * 1000
  const DAY = 24 * HOUR
  const at = (offsetMs: number) => new Date(now.getTime() + offsetMs).toISOString()

  let hostId: string
  let educationalTypeId: string
  let educationalTypeName: string
  let otherTypeId: string
  const ids: Record<string, string> = {}

  beforeAll(async () => {
    // Reuse the seeded Educational Prickle type (migration 20260424000002) --
    // normalized_name is unique, so don't insert a duplicate.
    const { data: eduType, error: eduErr } = await supabase
      .from('prickle_types')
      .select('id, name')
      .eq('normalized_name', 'educational')
      .single()
    expect(eduErr).toBeNull()
    educationalTypeId = eduType!.id
    educationalTypeName = eduType!.name

    const { data: otherType, error: otherErr } = await supabase
      .from('prickle_types')
      .select('id')
      .neq('normalized_name', 'educational')
      .limit(1)
      .single()
    expect(otherErr).toBeNull()
    otherTypeId = otherType!.id

    const { data: host, error: hostErr } = await supabase
      .from('members')
      .insert({
        name: `Tessaly Inkwright ${suffix}`,
        email: `edu-host-${suffix}@example.com`,
        joined_at: new Date('2022-01-01').toISOString(),
        status: 'active',
      })
      .select('id')
      .single()
    expect(hostErr).toBeNull()
    hostId = host!.id

    const fixtures: Record<string, { type_id: string; start: number; end: number; title: string; host: string | null }> = {
      inProgress: { type_id: educationalTypeId, start: -0.5 * HOUR, end: 0.5 * HOUR, title: `Live Craft Talk ${suffix}`, host: hostId },
      soon: { type_id: educationalTypeId, start: 3 * DAY, end: 3 * DAY + HOUR, title: `Query Letters 101 ${suffix}`, host: hostId },
      later: { type_id: educationalTypeId, start: 45 * DAY, end: 45 * DAY + HOUR, title: `Outlining Workshop ${suffix}`, host: null },
      nearEdge: { type_id: educationalTypeId, start: 89 * DAY, end: 89 * DAY + HOUR, title: `Edge Session ${suffix}`, host: hostId },
      past: { type_id: educationalTypeId, start: -2 * DAY, end: -2 * DAY + HOUR, title: `Past Session ${suffix}`, host: hostId },
      beyondWindow: { type_id: educationalTypeId, start: 91 * DAY, end: 91 * DAY + HOUR, title: `Far Session ${suffix}`, host: hostId },
      nonEducational: { type_id: otherTypeId, start: 5 * DAY, end: 5 * DAY + HOUR, title: `Regular Prickle ${suffix}`, host: hostId },
    }

    for (const [key, f] of Object.entries(fixtures)) {
      const { data, error } = await supabase
        .from('prickles')
        .insert({
          type_id: f.type_id,
          start_time: at(f.start),
          end_time: at(f.end),
          title: f.title,
          host: f.host,
          source: 'calendar',
        })
        .select('id')
        .single()
      expect(error).toBeNull()
      ids[key] = data!.id
    }
  })

  afterAll(async () => {
    const created = Object.values(ids)
    if (created.length > 0) await supabase.from('prickles').delete().in('id', created)
    if (hostId) await supabase.from('members').delete().eq('id', hostId)
  })

  async function fetchMine() {
    // The lib types its client as the server client; the admin client has the same query API.
    const all = await fetchUpcomingEducationalPrickles(supabase as never, now)
    const mine = new Set(Object.values(ids))
    return all.filter((p) => mine.has(p.id))
  }

  it('returns only educational prickles that have not ended and start within 90 days, soonest first', async () => {
    const result = await fetchMine()
    expect(result.map((p) => p.id)).toEqual([ids.inProgress, ids.soon, ids.later, ids.nearEdge])
  })

  it('excludes past, beyond-window, and non-educational prickles', async () => {
    const resultIds = new Set((await fetchMine()).map((p) => p.id))
    expect(resultIds.has(ids.past)).toBe(false)
    expect(resultIds.has(ids.beyondWindow)).toBe(false)
    expect(resultIds.has(ids.nonEducational)).toBe(false)
  })

  it('maps title, type name, host name, and times into the shape the Events page expects', async () => {
    const result = await fetchMine()
    const soon = result.find((p) => p.id === ids.soon)!
    expect(soon).toEqual({
      id: ids.soon,
      title: `Query Letters 101 ${suffix}`,
      typeName: educationalTypeName,
      hostName: `Tessaly Inkwright ${suffix}`,
      startTime: expect.any(String),
      endTime: expect.any(String),
    })
    expect(new Date(soon.startTime).toISOString()).toBe(at(3 * DAY))
    expect(new Date(soon.endTime).toISOString()).toBe(at(3 * DAY + HOUR))

    // Hostless educational prickle: hostName is null rather than the row being dropped.
    const later = result.find((p) => p.id === ids.later)!
    expect(later.hostName).toBeNull()
    expect(later.title).toBe(`Outlining Workshop ${suffix}`)
  })
})
