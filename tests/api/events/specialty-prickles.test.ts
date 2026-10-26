import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { fetchUpcomingSpecialtyPrickles } from '@/lib/specialty-prickles'

/**
 * DB integration test for the Events page's specialty-prickles query
 * (lib/specialty-prickles.ts, called from app/(member)/events/page.tsx).
 *
 * Runs against an isolated far-future window (year 2185) with uniquely named
 * fixtures, and asserts only on the rows it created -- other tests may be
 * writing to the same local DB concurrently.
 */
describe('fetchUpcomingSpecialtyPrickles', () => {
  const supabase = getTestSupabaseAdminClient()
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const now = new Date('2185-01-15T12:00:00.000Z')
  const HOUR = 60 * 60 * 1000
  const DAY = 24 * HOUR
  const at = (offsetMs: number) => new Date(now.getTime() + offsetMs).toISOString()

  let hostId: string
  let specialtyTypeId: string
  let specialtyTypeName: string
  let otherTypeId: string
  const ids: Record<string, string> = {}

  beforeAll(async () => {
    // Own types, so the test doesn't depend on which seeded types are flagged specialty.
    const { data: types, error: typeErr } = await supabase
      .from('prickle_types')
      .insert([
        { name: `Specialty Test ${suffix}`, normalized_name: `specialty-test-${suffix}`, is_specialty: true },
        { name: `Everyday Test ${suffix}`, normalized_name: `everyday-test-${suffix}`, is_specialty: false },
      ])
      .select('id, name, is_specialty')
    expect(typeErr).toBeNull()
    const specialty = types!.find((t) => t.is_specialty)!
    specialtyTypeId = specialty.id
    specialtyTypeName = specialty.name
    otherTypeId = types!.find((t) => !t.is_specialty)!.id

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
      inProgress: { type_id: specialtyTypeId, start: -0.5 * HOUR, end: 0.5 * HOUR, title: `Live Craft Talk ${suffix}`, host: hostId },
      soon: { type_id: specialtyTypeId, start: 3 * DAY, end: 3 * DAY + HOUR, title: `Query Letters 101 ${suffix}`, host: hostId },
      later: { type_id: specialtyTypeId, start: 45 * DAY, end: 45 * DAY + HOUR, title: `Outlining Workshop ${suffix}`, host: null },
      nearEdge: { type_id: specialtyTypeId, start: 89 * DAY, end: 89 * DAY + HOUR, title: `Edge Session ${suffix}`, host: hostId },
      past: { type_id: specialtyTypeId, start: -2 * DAY, end: -2 * DAY + HOUR, title: `Past Session ${suffix}`, host: hostId },
      beyondWindow: { type_id: specialtyTypeId, start: 91 * DAY, end: 91 * DAY + HOUR, title: `Far Session ${suffix}`, host: hostId },
      nonSpecialty: { type_id: otherTypeId, start: 5 * DAY, end: 5 * DAY + HOUR, title: `Regular Prickle ${suffix}`, host: hostId },
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
    await supabase.from('prickle_types').delete().in('id', [specialtyTypeId, otherTypeId].filter(Boolean))
  })

  async function fetchMine() {
    // The lib types its client as the server client; the admin client has the same query API.
    const all = await fetchUpcomingSpecialtyPrickles(supabase as never, now)
    const mine = new Set(Object.values(ids))
    return all.filter((p) => mine.has(p.id))
  }

  it('returns only specialty prickles that have not ended and start within 90 days, soonest first', async () => {
    const result = await fetchMine()
    expect(result.map((p) => p.id)).toEqual([ids.inProgress, ids.soon, ids.later, ids.nearEdge])
  })

  it('excludes past, beyond-window, and non-specialty prickles', async () => {
    const resultIds = new Set((await fetchMine()).map((p) => p.id))
    expect(resultIds.has(ids.past)).toBe(false)
    expect(resultIds.has(ids.beyondWindow)).toBe(false)
    expect(resultIds.has(ids.nonSpecialty)).toBe(false)
  })

  it('maps title, type name, host name, and times into the shape the Events page expects', async () => {
    const result = await fetchMine()
    const soon = result.find((p) => p.id === ids.soon)!
    expect(soon).toEqual({
      id: ids.soon,
      title: `Query Letters 101 ${suffix}`,
      typeName: specialtyTypeName,
      hostName: `Tessaly Inkwright ${suffix}`,
      startTime: expect.any(String),
      endTime: expect.any(String),
    })
    expect(new Date(soon.startTime).toISOString()).toBe(at(3 * DAY))
    expect(new Date(soon.endTime).toISOString()).toBe(at(3 * DAY + HOUR))

    // Hostless specialty prickle: hostName is null rather than the row being dropped.
    const later = result.find((p) => p.id === ids.later)!
    expect(later.hostName).toBeNull()
    expect(later.title).toBe(`Outlining Workshop ${suffix}`)
  })
})
