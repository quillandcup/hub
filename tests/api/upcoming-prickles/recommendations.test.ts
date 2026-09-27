import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../../helpers/supabase'
import { PRIORITY, getRankedUpcomingPrickles, type RankedPrickle } from '@/lib/upcoming-prickles'
import { scoreRecommendation } from '@/lib/prickle-recommendations'
import { hostShortName } from '@/lib/formatters'

/**
 * DB integration test for the query path of getRankedUpcomingPrickles
 * (lib/upcoming-prickles.ts). The pure scoring in lib/prickle-recommendations.ts
 * is unit-tested elsewhere; this verifies that the two parallel fetch rounds
 * (upcoming prickles, member attendance, 60-day past prickles; then past
 * attendance and all-time hosted counts) feed that scoring correctly.
 *
 * Isolation: every fixture lives in a far-future window (year 2183) and all
 * names/emails carry a random suffix. Assertions only look at our own
 * prickles, since other tests may share the local DB concurrently.
 *
 * Pagination: a "filler" member has 2,400 leave/rejoin attendance rows across
 * the experienced host's 8 past prickles, so the past-attendance fetch for the
 * lookback window spans 3 pages of 1000. Attendance IDs are random UUIDs and the
 * query orders by id, so without pagination only ~40% of the 40 meaningful
 * (host + regulars) rows would come back and the exact popularity/regulars
 * numbers asserted below would not hold.
 */
describe('getRankedUpcomingPrickles (DB)', () => {
  const supabase = getTestSupabaseAdminClient()
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const TZ = 'America/New_York'
  const HOUR = 60 * 60 * 1000
  const DAY = 24 * HOUR
  const WINDOW_DAYS = 14
  // "now" for the ranking call. The experienced host's slot is 2 hours after it (14:00Z = 10am EDT).
  const now = new Date('2183-05-05T12:00:00.000Z')
  const slotBase = now.getTime() + 2 * HOUR

  const FILLER_ROWS_PER_PRICKLE = 300
  const PAST_IN_LOOKBACK = 8 // weekly, 7..56 days back -- inside the 60-day lookback
  const PAST_OLDER = 6 // 84..119 days back -- only counts toward all-time hosted
  const EXPECTED_HOSTED = PAST_IN_LOOKBACK + PAST_OLDER

  const memberIds: Record<string, string> = {}
  const prickleIds: string[] = []
  let experiencedUpcomingId: string
  let newHostUpcomingId: string
  let viewerHostedUpcomingId: string
  let commitPastId: string
  let commitUpcomingId: string
  let commitSatPastId: string
  let commitSatUpcomingId: string
  const commitmentIds: string[] = []
  let typeId: string

  async function insertMember(key: string, name: string) {
    const { data, error } = await supabase
      .from('members')
      .insert({
        name: `${name} ${suffix}`,
        email: `rec-${key}-${suffix}@example.com`,
        joined_at: new Date('2022-01-01').toISOString(),
        status: 'active',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    memberIds[key] = data!.id
  }

  async function insertPrickle(startMs: number, host: string | null): Promise<string> {
    const { data, error } = await supabase
      .from('prickles')
      .insert({
        type_id: typeId,
        start_time: new Date(startMs).toISOString(),
        end_time: new Date(startMs + HOUR).toISOString(),
        host,
        source: 'calendar',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    prickleIds.push(data!.id)
    return data!.id
  }

  beforeAll(async () => {
    const { data: type, error: typeErr } = await supabase
      .from('prickle_types')
      .select('id')
      .eq('normalized_name', 'progress')
      .single()
    expect(typeErr).toBeNull()
    typeId = type!.id

    await Promise.all([
      insertMember('viewer', 'Wren Newcomer'),
      insertMember('viewerHost', 'Juniper Selfhost'),
      insertMember('experienced', 'Marigold Longhost'),
      insertMember('newHost', 'Basil Freshhost'),
      insertMember('filler', 'Poppy Rejoiner'),
      insertMember('reg1', 'Rowan Regular'),
      insertMember('reg2', 'Sorrel Regular'),
      insertMember('reg3', 'Thistle Regular'),
      insertMember('reg4', 'Yarrow Regular'),
      insertMember('committer', 'Clover Committer'),
    ])

    // Experienced host: 8 weekly past sessions in the lookback + 6 older ones.
    const pastInLookback: { id: string; startMs: number }[] = []
    for (let k = 1; k <= PAST_IN_LOOKBACK; k++) {
      const startMs = slotBase - k * 7 * DAY
      pastInLookback.push({ id: await insertPrickle(startMs, memberIds.experienced), startMs })
    }
    for (let k = 12; k < 12 + PAST_OLDER; k++) {
      await insertPrickle(slotBase - k * 7 * DAY, memberIds.experienced)
    }

    // Upcoming: experienced host in the same weekly slot 7 days out; a brand-new
    // host sooner (tomorrow, different hour); the "viewerHost" member hosting later.
    experiencedUpcomingId = await insertPrickle(slotBase + 7 * DAY, memberIds.experienced)
    newHostUpcomingId = await insertPrickle(now.getTime() + 1 * DAY + 6 * HOUR, memberIds.newHost)
    viewerHostedUpcomingId = await insertPrickle(now.getTime() + 10 * DAY + 8 * HOUR, memberIds.viewerHost)

    // Filler rows first (bulk), then the meaningful rows.
    const filler: Record<string, unknown>[] = []
    for (const p of pastInLookback) {
      for (let i = 0; i < FILLER_ROWS_PER_PRICKLE; i++) {
        filler.push({
          member_id: memberIds.filler,
          prickle_id: p.id,
          join_time: new Date(p.startMs + 60_000 + i * 1000).toISOString(),
          leave_time: new Date(p.startMs + 60_000 + i * 1000 + 500).toISOString(),
          confidence_score: 'high',
        })
      }
    }
    const chunks: Record<string, unknown>[][] = []
    for (let i = 0; i < filler.length; i += 500) chunks.push(filler.slice(i, i + 500))
    const fillerResults = await Promise.all(chunks.map((c) => supabase.from('prickle_attendance').insert(c)))
    for (const r of fillerResults) expect(r.error).toBeNull()

    const meaningful: Record<string, unknown>[] = []
    for (const p of pastInLookback) {
      // Host joins right at start (on time); four regulars attend every session.
      for (const key of ['experienced', 'reg1', 'reg2', 'reg3', 'reg4']) {
        meaningful.push({
          member_id: memberIds[key],
          prickle_id: p.id,
          join_time: new Date(p.startMs).toISOString(),
          leave_time: new Date(p.startMs + HOUR).toISOString(),
          confidence_score: 'high',
        })
      }
    }
    const { error: mErr } = await supabase.from('prickle_attendance').insert(meaningful)
    expect(mErr).toBeNull()

    // Commitment fixtures: a separate, hostless weekly slot -- Thursdays 12:00 PM ET (16:00Z in
    // May) -- so the experienced-host slot's numbers above are untouched. The committer attended
    // last Thursday's session (2183-05-01) and committed for 3 weeks starting then: week 1 = last
    // Thursday (kept), week 2 = this Thursday 2183-05-08 (upcoming), week 3 = no prickle yet.
    const thisThursday = now.getTime() + 3 * DAY + 4 * HOUR // 2183-05-08T16:00Z = Thu 12:00 PM EDT
    commitPastId = await insertPrickle(thisThursday - 7 * DAY, null)
    commitUpcomingId = await insertPrickle(thisThursday, null)
    const { error: caErr } = await supabase.from('prickle_attendance').insert({
      member_id: memberIds.committer,
      prickle_id: commitPastId,
      join_time: new Date(thisThursday - 7 * DAY).toISOString(),
      leave_time: new Date(thisThursday - 7 * DAY + HOUR).toISOString(),
      confidence_score: 'high',
    })
    expect(caErr).toBeNull()

    // A second slot of the same commitment: Saturdays 12:00 PM ET. The committer attended last
    // Saturday's (2183-05-03), so 2 sessions are kept so far across the two slots.
    const thisSaturday = thisThursday + 2 * DAY // 2183-05-10T16:00Z
    commitSatPastId = await insertPrickle(thisSaturday - 7 * DAY, null)
    commitSatUpcomingId = await insertPrickle(thisSaturday, null)
    const { error: csErr } = await supabase.from('prickle_attendance').insert({
      member_id: memberIds.committer,
      prickle_id: commitSatPastId,
      join_time: new Date(thisSaturday - 7 * DAY).toISOString(),
      leave_time: new Date(thisSaturday - 7 * DAY + HOUR).toISOString(),
      confidence_score: 'high',
    })
    expect(csErr).toBeNull()

    const { data: commitRows, error: cErr } = await supabase
      .from('prickle_commitments')
      .insert([
        // Active: Thursdays + Saturdays 12:00 for 3 weeks from last Thursday.
        // (Every row spells out status/cancelled_at: a multi-row insert nulls keys a row omits.)
        { member_id: memberIds.committer, start_date: '2183-05-01', weeks: 3, status: 'active', cancelled_at: null },
        // Cancelled commitment on the experienced host's Monday 10:00 slot -- must be ignored.
        {
          member_id: memberIds.committer,
          start_date: '2183-05-05',
          weeks: 4,
          status: 'cancelled',
          cancelled_at: now.toISOString(),
        },
      ])
      .select('id, status')
    expect(cErr).toBeNull()
    commitmentIds.push(...commitRows!.map((r) => r.id))
    const activeId = commitRows!.find((r) => r.status === 'active')!.id
    const cancelledId = commitRows!.find((r) => r.status === 'cancelled')!.id
    const slotBaseRow = { type_id: typeId, start_time_local: '12:00', timezone: TZ }
    const { error: sErr } = await supabase.from('prickle_commitment_slots').insert([
      { ...slotBaseRow, commitment_id: activeId, day_of_week: 4 },
      { ...slotBaseRow, commitment_id: activeId, day_of_week: 6 },
      { ...slotBaseRow, commitment_id: cancelledId, day_of_week: 1, start_time_local: '10:00' },
    ])
    expect(sErr).toBeNull()
  }, 60_000)

  afterAll(async () => {
    if (commitmentIds.length > 0) await supabase.from('prickle_commitments').delete().in('id', commitmentIds)
    if (prickleIds.length > 0) {
      await supabase.from('prickle_attendance').delete().in('prickle_id', prickleIds)
      await supabase.from('prickles').delete().in('id', prickleIds)
    }
    const ids = Object.values(memberIds)
    if (ids.length > 0) await supabase.from('members').delete().in('id', ids)
  }, 60_000)

  async function rankFor(memberKey: string): Promise<RankedPrickle[]> {
    // The lib types its client as the server client; the admin client has the same query API.
    const all = await getRankedUpcomingPrickles(supabase as never, memberIds[memberKey], TZ, now, WINDOW_DAYS)
    const mine = new Set([experiencedUpcomingId, newHostUpcomingId, viewerHostedUpcomingId])
    return all.filter((r) => mine.has(r.prickle.id))
  }

  const kinds = (r: RankedPrickle) => r.reasons.map((x) => x.kind)

  it('ranks the experienced, well-attended host above a sooner brand-new host for a no-signal viewer', async () => {
    const ranked = await rankFor('viewer')
    expect(ranked).toHaveLength(3)

    const ids = ranked.map((r) => r.prickle.id)
    expect(ids[0]).toBe(experiencedUpcomingId)
    expect(ids.indexOf(experiencedUpcomingId)).toBeLessThan(ids.indexOf(newHostUpcomingId))
    // Sanity: the new host's prickle really is sooner, so this isn't just chronological order.
    const byId = new Map(ranked.map((r) => [r.prickle.id, r]))
    expect(new Date(byId.get(newHostUpcomingId)!.prickle.startTime).getTime()).toBeLessThan(
      new Date(byId.get(experiencedUpcomingId)!.prickle.startTime).getTime(),
    )

    // No personal signals for this viewer.
    for (const r of ranked) expect(r.priority).toBe(PRIORITY.none)
    expect(byId.get(newHostUpcomingId)!.recommendationScore).toBe(0)
  })

  it('attaches Experienced host / Popular session / Lots of regulars badges from real DB data', async () => {
    const ranked = await rankFor('viewer')
    const experienced = ranked.find((r) => r.prickle.id === experiencedUpcomingId)!
    expect(experienced.prickle.hostName).toBe(`Marigold Longhost ${suffix}`)
    expect(kinds(experienced)).toEqual(['experiencedHost', 'popular', 'regulars'])

    const tooltip = (kind: string) => experienced.reasons.find((r) => r.kind === kind)!.tooltip
    // All-time hosted count includes sessions older than the 60-day lookback.
    expect(tooltip('experiencedHost')).toEqual([`${hostShortName(`Marigold Longhost ${suffix}`)} has hosted ${EXPECTED_HOSTED} sessions`, 'Reliably there on time'])
    // 6 distinct attendees per occurrence (host + 4 regulars + filler), despite 300 rows from the filler
    // -- only reachable if all 2,440 attendance rows were paged in and counted distinctly.
    expect(tooltip('popular')).toEqual(['Usually about 6 writers'])
    expect(tooltip('regulars')).toEqual(['Usually 6 regulars — Hedgies who come most weeks'])

    // Score matches the pure scorer fed the inputs the DB fixtures imply.
    expect(experienced.recommendationScore).toBeCloseTo(
      scoreRecommendation(
        { hostedCount: EXPECTED_HOSTED, recentHosted: PAST_IN_LOOKBACK, recentShowedUp: PAST_IN_LOOKBACK, recentOnTime: PAST_IN_LOOKBACK },
        { occurrences: PAST_IN_LOOKBACK, avgAttendance: 6, avgRegulars: 6 },
      ),
      10,
    )
    // ...and host experience actually contributes on top of the slot signals.
    expect(experienced.recommendationScore).toBeGreaterThan(
      scoreRecommendation(undefined, { occurrences: PAST_IN_LOOKBACK, avgAttendance: 6, avgRegulars: 6 }),
    )

    // Brand-new host with no history earns no recommendation badges.
    const fresh = ranked.find((r) => r.prickle.id === newHostUpcomingId)!
    expect(kinds(fresh)).toEqual([])
  })

  it('still ranks a personal signal (viewer is hosting) first, ahead of the strong recommendation', async () => {
    const ranked = await rankFor('viewerHost')
    expect(ranked[0].prickle.id).toBe(viewerHostedUpcomingId)
    expect(ranked[0].priority).toBe(PRIORITY.hosting)
    expect(kinds(ranked[0])).toContain('hosting')

    // The experienced host's prickle is the top non-personal pick, badges intact.
    expect(ranked[1].prickle.id).toBe(experiencedUpcomingId)
    expect(ranked[1].priority).toBe(PRIORITY.none)
    expect(kinds(ranked[1])).toEqual(['experiencedHost', 'popular', 'regulars'])
  })

  it('ranks upcoming prickles matching ANY slot of an active commitment in the commitment tier, with week/kept progress', async () => {
    const all = await getRankedUpcomingPrickles(supabase as never, memberIds.committer, TZ, now, WINDOW_DAYS)
    const mine = new Set([
      experiencedUpcomingId,
      newHostUpcomingId,
      viewerHostedUpcomingId,
      commitUpcomingId,
      commitSatUpcomingId,
    ])
    const ranked = all.filter((r) => mine.has(r.prickle.id))

    // Both committed slots' next sessions (hostless, sparse) outrank the strong experienced-host
    // recommendation, soonest first.
    expect(ranked.slice(0, 2).map((r) => r.prickle.id)).toEqual([commitUpcomingId, commitSatUpcomingId])
    for (const r of ranked.slice(0, 2)) {
      expect(r.priority).toBe(PRIORITY.commitment)
      expect(r.reasons.find((x) => x.kind === 'commitment')).toEqual({
        kind: 'commitment',
        tooltip: ['Week 2 of 3 · 2 sessions kept so far'],
      })
    }

    // The cancelled commitment on the experienced host's slot adds nothing.
    const experienced = ranked.find((r) => r.prickle.id === experiencedUpcomingId)!
    expect(experienced.priority).toBe(PRIORITY.none)
    expect(kinds(experienced)).not.toContain('commitment')

    // Commitments are per member: the no-signal viewer sees no commitment badge on that prickle.
    const forViewer = await getRankedUpcomingPrickles(supabase as never, memberIds.viewer, TZ, now, WINDOW_DAYS)
    const committedForViewer = forViewer.find((r) => r.prickle.id === commitUpcomingId)!
    expect(committedForViewer.priority).toBe(PRIORITY.none)
    expect(kinds(committedForViewer)).not.toContain('commitment')
  })
})
