import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../helpers/supabase'
import { computeMemberEngagementMetrics } from '@/lib/member-engagement'
import { fetchAdminMembersPage, MEMBER_FILTERS, type AdminMemberPageRow } from '@/lib/admin-members-paging'

/**
 * The live /admin/members data path: admin_members_page + admin_member_filter_counts
 * (supabase/migrations/20260926001000_admin_members_paging.sql) via fetchAdminMembersPage.
 *
 * Replaces three older tests that re-implemented the page's former in-memory
 * logic (member-filters, member-search-aliases, admin-members-attendance-pagination);
 * their cases live here now, against the real SQL.
 *
 * Seeds fictional members whose names share a unique token, so p_search scopes
 * every call to just this test's rows in the shared DB. Uses the service-role
 * client for fixtures (RLS requires is_admin() for writes).
 */
describe('admin members paging (admin_members_page / admin_member_filter_counts)', () => {
  const supabase = getTestSupabaseAdminClient()
  const token = `pagingtest${Date.now()}`
  const now = new Date('2099-06-30T12:00:00Z')
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString()

  // key, status, prickle_attended days-ago list, other recent activity points
  const specs: { key: string; status: string; attended: number[]; slackPoints?: number }[] = [
    { key: 'alpha', status: 'active', attended: [1, 2, 3, 4, 5, 6] }, // score 60 -> highly_engaged, low risk
    { key: 'bravo', status: 'active', attended: [20] }, // 10 pts, medium risk
    { key: 'charlie', status: 'on_hiatus', attended: [45, 60] }, // old attendance only -> high risk
    { key: 'delta', status: 'cancelled', attended: [] }, // never attended -> high risk, but cancelled
    { key: 'echo', status: 'active', attended: [], slackPoints: 3 }, // slack only, never attended -> high risk
    { key: 'foxtrot', status: 'lead', attended: [10] }, // + 1200 old attendances (see BIG_MEMBER_ROWS)
    { key: 'golf', status: 'lead', attended: [] }, // never attended -> high risk, but a lead
    { key: 'hotel', status: 'on_hiatus', attended: [3] }, // recent -> low risk
  ]
  const BIG_MEMBER_ROWS = 1200
  const ids: Record<string, string> = {}
  const aliasIds: string[] = []

  beforeAll(async () => {
    const { data: members, error } = await supabase
      .from('members')
      .insert(
        specs.map((s) => ({
          name: `${token} ${s.key}`,
          email: `${token}-${s.key}@example.com`,
          joined_at: '2020-01-01',
          status: s.status,
        }))
      )
      .select('id, email')
    if (error) throw error
    for (const m of members!) ids[m.email.split('-')[1].split('@')[0]] = m.id

    const activity = (memberId: string, i: number, occurredAt: string, type = 'prickle_attended', value = 10) => ({
      member_id: memberId,
      activity_type: type,
      activity_category: type === 'prickle_attended' ? 'event' : 'community',
      title: 'paging test activity',
      actor_kind: 'member',
      related_id: `${token}-${memberId}-${i}`,
      engagement_value: value,
      occurred_at: occurredAt,
      source: type === 'prickle_attended' ? 'prickle_attendance' : 'slack',
    })
    const rows = specs.flatMap((s) => [
      ...s.attended.map((d, i) => activity(ids[s.key], i, daysAgo(d))),
      ...(s.slackPoints ? [activity(ids[s.key], 999, daysAgo(2), 'slack_message', s.slackPoints)] : []),
    ])
    // foxtrot gets 1200 more (old) attendances to prove aggregation isn't capped at 1000 rows.
    for (let i = 0; i < BIG_MEMBER_ROWS; i++) rows.push(activity(ids.foxtrot, 1000 + i, daysAgo(400 + (i % 300))))
    // Insert in chunks of 500 (CLAUDE.md batching guidance).
    for (let i = 0; i < rows.length; i += 500) {
      const { error: insertError } = await supabase.from('member_activities').insert(rows.slice(i, i + 500))
      if (insertError) throw insertError
    }

    // A zoom display-name alias is searchable; a slack alias (opaque user id) is not.
    const { data: aliases, error: aliasError } = await supabase
      .from('member_name_aliases')
      .insert([
        { member_id: ids.bravo, alias: `Zoomy${token}`, source: 'zoom' },
        { member_id: ids.charlie, alias: `U0SLACK${token}`, source: 'slack' },
      ])
      .select('id')
    if (aliasError) throw aliasError
    aliasIds.push(...aliases!.map((a) => a.id))
  })

  afterAll(async () => {
    if (aliasIds.length > 0) await supabase.from('member_name_aliases').delete().in('id', aliasIds)
    const memberIds = Object.values(ids)
    if (memberIds.length === 0) return
    await supabase.from('member_activities').delete().in('member_id', memberIds)
    await supabase.from('members').delete().in('id', memberIds)
  })

  async function page(args: {
    filter?: string
    search?: string
    sort?: string
    dir?: string
    limit?: number
    offset?: number
  }) {
    const { data, error } = await supabase.rpc('admin_members_page', {
      p_filter: args.filter ?? 'all',
      p_search: args.search ?? token,
      p_sort: args.sort ?? 'name',
      p_direction: args.dir ?? 'asc',
      p_limit: args.limit ?? 50,
      p_offset: args.offset ?? 0,
      p_now: now.toISOString(),
    })
    if (error) throw error
    return data as AdminMemberPageRow[]
  }
  const keyOf = (row: { name: string }) => row.name.replace(`${token} `, '')
  const keys = async (args: Parameters<typeof page>[0]) => (await page(args)).map(keyOf)

  describe('engagement metrics', () => {
    it('match computeMemberEngagementMetrics', async () => {
      const rows = await page({})
      const { data: activities } = await supabase
        .from('member_activities')
        .select('member_id, activity_type, engagement_value, occurred_at')
        .in('member_id', Object.values(ids))
        .range(0, 4999)
      const all = activities ?? []
      const expected = computeMemberEngagementMetrics(
        all.filter((a) => a.activity_type === 'prickle_attended'),
        Object.values(ids),
        now,
        all.filter((a) => new Date(a.occurred_at).getTime() >= now.getTime() - 30 * 24 * 60 * 60 * 1000)
      )

      expect(rows).toHaveLength(specs.length)
      for (const row of rows) {
        const m = expected.get(row.id)!
        expect({
          key: keyOf(row),
          last: row.last_attended_at ? new Date(row.last_attended_at).toISOString() : null,
          p30: row.prickles_last_30_days,
          total: row.total_prickles,
          score: row.engagement_score,
          risk: row.risk_level,
          tier: row.engagement_tier,
        }).toEqual({
          key: keyOf(row),
          last: m.lastAttendedAt,
          p30: m.pricklesLast30Days,
          total: m.totalPrickles,
          score: m.engagementScore,
          risk: m.riskLevel,
          tier: m.engagementTier,
        })
      }
    })

    it('aggregates past the 1000-row limit', async () => {
      const rows = await page({})
      expect(rows.find((r) => keyOf(r) === 'foxtrot')?.total_prickles).toBe(BIG_MEMBER_ROWS + 1)
    })
  })

  describe('filter tabs', () => {
    const expectedByFilter: Record<(typeof MEMBER_FILTERS)[number], string[]> = {
      all: ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'],
      active: ['alpha', 'bravo', 'echo'],
      // High risk AND still around (active/on_hiatus). delta (cancelled) and
      // golf (lead) are high risk too but must never surface as at-risk.
      at_risk: ['charlie', 'echo'],
      highly_engaged: ['alpha'],
      on_hiatus: ['charlie', 'hotel'],
      lead: ['foxtrot', 'golf'],
      cancelled: ['delta'],
      // Active with no linked login (fixtures have no user_id).
      unregistered: ['alpha', 'bravo', 'echo'],
    }

    it.each(MEMBER_FILTERS)('filter=%s returns exactly its members', async (filter) => {
      expect(await keys({ filter })).toEqual(expectedByFilter[filter])
    })

    it('reports a count per tab for the current search, ignoring the selected tab', async () => {
      const { data, error } = await supabase.rpc('admin_member_filter_counts', {
        p_search: token,
        p_now: now.toISOString(),
      })
      expect(error).toBeNull()
      expect(data[0]).toMatchObject(
        Object.fromEntries(Object.entries(expectedByFilter).map(([f, members]) => [f, members.length]))
      )
    })

    it('treats an unknown filter as all', async () => {
      expect(await keys({ filter: 'bogus' })).toEqual(expectedByFilter.all)
    })
  })

  describe('search', () => {
    it('matches the canonical name and the email', async () => {
      expect(await keys({ search: `${token} bravo` })).toEqual(['bravo'])
      expect(await keys({ search: `${token}-delta@example` })).toEqual(['delta'])
    })

    it('matches a zoom alias that differs from the canonical name, and nothing else', async () => {
      expect(await keys({ search: `zoomy${token}` })).toEqual(['bravo'])
    })

    it('does not match a slack-source alias (opaque user id, not a name)', async () => {
      expect(await keys({ search: `U0SLACK${token}` })).toEqual([])
    })

    it('returns nothing for a term matching neither a member nor an alias', async () => {
      expect(await keys({ search: `nonexistent-${token}` })).toEqual([])
    })

    it('treats % and _ literally', async () => {
      expect(await keys({ search: '%' })).not.toContain('alpha')
      expect(await keys({ search: `${token}_alpha` })).toEqual([])
    })
  })

  describe('sorting and paging', () => {
    it('returns disjoint pages that together cover the sorted list, with the filtered total', async () => {
      const full = await page({ sort: 'total_prickles', dir: 'desc' })
      const first = await page({ sort: 'total_prickles', dir: 'desc', limit: 5, offset: 0 })
      const second = await page({ sort: 'total_prickles', dir: 'desc', limit: 5, offset: 5 })
      expect(first).toHaveLength(5)
      expect(second).toHaveLength(3)
      expect([...first, ...second].map(keyOf)).toEqual(full.map(keyOf))
      expect(Number(first[0].total_count)).toBe(specs.length)
      // Sorting is global, not per page: the biggest attender leads page 1.
      expect(keyOf(first[0])).toBe('foxtrot')
    })

    it('sorts never-attended members as the oldest last-attended date in both directions', async () => {
      const asc = await keys({ sort: 'last_attended_at', dir: 'asc' })
      const desc = await keys({ sort: 'last_attended_at', dir: 'desc' })
      expect(asc.slice(0, 3)).toEqual(['delta', 'echo', 'golf']) // ties break by name
      expect(desc.slice(-3)).toEqual(['delta', 'echo', 'golf'])
      expect(asc[3]).toBe('charlie') // oldest real attendance (45 days ago)
      expect(desc[0]).toBe('alpha')
    })

    it('rejects unknown sort columns by falling back to name (direction still applies)', async () => {
      expect(await keys({ sort: 'name; drop table members', dir: 'desc' })).toEqual(
        ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'].reverse()
      )
    })
  })

  describe('fetchAdminMembersPage', () => {
    it('returns one page in table shape, with counts, and clamps a page past the end', async () => {
      const result = await fetchAdminMembersPage(supabase, {
        filter: 'all',
        search: token,
        sort: { column: 'name', direction: 'asc' },
        page: 99,
        pageSize: 5,
        now,
      })
      expect(result.page).toBe(2)
      expect(result.total).toBe(8)
      expect(result.counts.at_risk).toBe(2)
      expect(result.members.map(keyOf)).toEqual(['foxtrot', 'golf', 'hotel'])
      expect(result.members[0]).toMatchObject({
        member_metrics: { total_prickles: BIG_MEMBER_ROWS + 1 },
        member_engagement: { risk_level: 'low' },
      })
    })

    it('handles an empty result', async () => {
      const result = await fetchAdminMembersPage(supabase, {
        filter: 'all',
        search: `nonexistent-${token}`,
        sort: { column: 'name', direction: 'asc' },
        page: 1,
        pageSize: 50,
        now,
      })
      expect(result).toMatchObject({ members: [], total: 0, page: 1 })
    })
  })
})
