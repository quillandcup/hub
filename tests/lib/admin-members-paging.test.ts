import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../helpers/supabase'
import { computeMemberEngagementMetrics } from '@/lib/member-engagement'
import { fetchAdminMembersPage, type AdminMemberPageRow } from '@/lib/admin-members-paging'

/**
 * Server-side paging for /admin/members (supabase/migrations/20260926001000_admin_members_paging.sql).
 *
 * Seeds a handful of fictional members whose names share a unique token, so
 * p_search scopes every call to just this test's rows in the shared DB.
 * Checks the SQL metrics match lib/member-engagement.ts, that ORDER BY +
 * LIMIT/OFFSET pages are disjoint and complete, that sorting applies across
 * pages, and that aggregation isn't capped at PostgREST's 1000 rows.
 */
describe('admin_members_page / admin_member_filter_counts', () => {
  const supabase = getTestSupabaseAdminClient()
  const token = `pagingtest${Date.now()}`
  const now = new Date('2099-06-30T12:00:00Z')
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString()

  // name suffix, status, prickle_attended days-ago list, other recent activity points
  const specs: { key: string; status: string; attended: number[]; slackPoints?: number }[] = [
    { key: 'alpha', status: 'active', attended: [1, 2, 3, 4, 5, 6] }, // score 60 -> highly_engaged, low risk
    { key: 'bravo', status: 'active', attended: [20] }, // 10 pts, medium risk
    { key: 'charlie', status: 'on_hiatus', attended: [45, 60] }, // old attendance only -> high risk
    { key: 'delta', status: 'cancelled', attended: [] }, // never attended
    { key: 'echo', status: 'active', attended: [], slackPoints: 3 }, // slack only, never attended
    { key: 'foxtrot', status: 'lead', attended: [10] },
  ]
  const BIG_MEMBER_ROWS = 1200
  const ids: Record<string, string> = {}

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
    for (let i = 0; i < rows.length; i += 500) {
      const { error: insertError } = await supabase.from('member_activities').insert(rows.slice(i, i + 500))
      if (insertError) throw insertError
    }
  })

  afterAll(async () => {
    const memberIds = Object.values(ids)
    if (memberIds.length === 0) return
    await supabase.from('member_activities').delete().in('member_id', memberIds)
    await supabase.from('members').delete().in('id', memberIds)
  })

  async function page(args: { filter?: string; sort?: string; dir?: string; limit?: number; offset?: number }) {
    const { data, error } = await supabase.rpc('admin_members_page', {
      p_filter: args.filter ?? 'all',
      p_search: token,
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

  it('computes the same metrics as computeMemberEngagementMetrics', async () => {
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

  it('returns disjoint pages that together cover the sorted list, with the filtered total', async () => {
    const full = await page({ sort: 'total_prickles', dir: 'desc' })
    const first = await page({ sort: 'total_prickles', dir: 'desc', limit: 4, offset: 0 })
    const second = await page({ sort: 'total_prickles', dir: 'desc', limit: 4, offset: 4 })
    expect(first).toHaveLength(4)
    expect(second).toHaveLength(2)
    expect([...first, ...second].map(keyOf)).toEqual(full.map(keyOf))
    expect(Number(first[0].total_count)).toBe(specs.length)
    // Sorting is global, not per page: the biggest attender leads page 1.
    expect(keyOf(first[0])).toBe('foxtrot')
  })

  it('sorts never-attended members as the oldest last-attended date in both directions', async () => {
    const asc = (await page({ sort: 'last_attended_at', dir: 'asc' })).map(keyOf)
    const desc = (await page({ sort: 'last_attended_at', dir: 'desc' })).map(keyOf)
    expect(asc.slice(0, 2)).toEqual(['delta', 'echo'])
    expect(desc.slice(-2)).toEqual(['delta', 'echo'])
    expect(asc[2]).toBe('charlie') // oldest most-recent attendance (45 days ago)
    expect(desc[0]).toBe('alpha')
  })

  it('applies filter tabs and reports per-tab counts for the search', async () => {
    const atRisk = (await page({ filter: 'at_risk' })).map(keyOf)
    // high risk AND still around (active/on_hiatus): charlie (old), echo (never). delta is cancelled.
    expect(atRisk).toEqual(['charlie', 'echo'])

    const { data, error } = await supabase.rpc('admin_member_filter_counts', {
      p_search: token,
      p_now: now.toISOString(),
    })
    expect(error).toBeNull()
    expect(data[0]).toMatchObject({
      all: 6,
      active: 3,
      at_risk: 2,
      highly_engaged: 1,
      on_hiatus: 1,
      lead: 1,
      cancelled: 1,
      unregistered: 3,
    })
  })

  it('fetchAdminMembersPage clamps a page past the end to the last page', async () => {
    const result = await fetchAdminMembersPage(supabase, {
      filter: 'all',
      search: token,
      sort: { column: 'name', direction: 'asc' },
      page: 99,
      pageSize: 4,
      now,
    })
    expect(result.page).toBe(2)
    expect(result.total).toBe(6)
    expect(result.members.map(keyOf)).toEqual(['echo', 'foxtrot'])
  })

  it('finds members by a zoom alias (not a slack alias) and treats % and _ literally', async () => {
    const { data: aliases, error } = await supabase
      .from('member_name_aliases')
      .insert([
        { member_id: ids.bravo, alias: `Zoomy${token}`, source: 'zoom' },
        { member_id: ids.charlie, alias: `U0SLACK${token}`, source: 'slack' },
      ])
      .select('id')
    expect(error).toBeNull()
    try {
      const search = async (p_search: string) => {
        const { data, error: rpcError } = await supabase.rpc('admin_members_page', {
          p_filter: 'all',
          p_search,
          p_now: now.toISOString(),
        })
        if (rpcError) throw rpcError
        return (data as AdminMemberPageRow[]).map(keyOf)
      }
      expect(await search(`zoomy${token}`)).toEqual(['bravo'])
      expect(await search(`U0SLACK${token}`)).toEqual([])
      // A bare wildcard must not match everyone.
      expect(await search('%')).not.toContain('alpha')
    } finally {
      await supabase.from('member_name_aliases').delete().in('id', (aliases ?? []).map((a) => a.id))
    }
  })

  it('rejects unknown sort columns by falling back to name (direction still applies)', async () => {
    const rows = await page({ sort: 'name; drop table members', dir: 'desc' })
    expect(rows.map(keyOf)).toEqual(['foxtrot', 'echo', 'delta', 'charlie', 'bravo', 'alpha'])
  })
})
