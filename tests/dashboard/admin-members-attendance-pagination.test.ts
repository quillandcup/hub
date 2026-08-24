import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../helpers/supabase'
import { seedReferenceData } from '../helpers/seed-data'
import { computeMemberEngagementMetrics, type EngagementAttendanceRow } from '@/lib/member-engagement'

/**
 * Regression test for the /admin/members?filter=all Bad Request bug (commit 50816d9).
 *
 * The page used to fetch attendance with `.in("member_id", memberIds)`. With the
 * "all" filter, memberIds could grow long enough to exceed Supabase's gateway URL
 * length limit, returning a 400 that crashed the page. The fix fetches
 * prickle_attendance unfiltered via pagination (same helper the CLAUDE.md pagination
 * rule requires for tables >1000 rows) and filters in memory instead.
 *
 * This test reproduces the exact fetch algorithm the page now uses (unfiltered,
 * paginated in batches of 1000) and confirms it recovers every row for a member with
 * more than 1000 attendance records without loss — the scenario that was previously
 * unreachable because the query never got past the gateway.
 */
describe('Admin members page — attendance pagination (no member_id filter)', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()
  const testEmail = `pagination-test-${ts}@example.com`

  let testMemberId: string
  let prickleTypeId: string
  const prickleIds: string[] = []

  // Mirrors fetchAllAttendance() in app/(admin)/admin/members/page.tsx exactly —
  // no `.in("member_id", ...)` filter, just unfiltered pagination.
  async function fetchAllAttendanceUnfiltered(): Promise<EngagementAttendanceRow[]> {
    const BATCH = 1000
    const rows: EngagementAttendanceRow[] = []
    let offset = 0
    let hasMore = true

    while (hasMore) {
      const { data, error } = await supabase
        .from('prickle_attendance')
        .select('member_id, prickle_id, join_time')
        .order('join_time', { ascending: true })
        .range(offset, offset + BATCH - 1)

      if (error) throw error
      if (data && data.length > 0) {
        rows.push(...data)
        offset += data.length
        hasMore = data.length === BATCH
      } else {
        hasMore = false
      }
    }

    return rows
  }

  beforeAll(async () => {
    await seedReferenceData()

    const { data: pupType } = await supabase
      .from('prickle_types')
      .select('id')
      .eq('normalized_name', 'pop-up')
      .single()
    prickleTypeId = pupType!.id

    const { data: member } = await supabase
      .from('members')
      .insert({
        name: 'Pagination Test Member',
        email: testEmail,
        joined_at: '2020-01-01',
        status: 'active',
      })
      .select('id')
      .single()
    testMemberId = member!.id

    // 3 distinct prickles, each attended with several leave/rejoin records, totaling
    // 1200 attendance rows for this member — enough to cross the 1000-row page boundary.
    for (let p = 0; p < 3; p++) {
      const { data: prickle } = await supabase
        .from('prickles')
        .insert({
          type_id: prickleTypeId,
          start_time: `2099-0${p + 1}-01T10:00:00Z`,
          end_time: `2099-0${p + 1}-01T18:00:00Z`,
          source: 'zoom',
        })
        .select('id')
        .single()
      prickleIds.push(prickle!.id)
    }

    const ATTENDANCE_ROWS_PER_PRICKLE = 400
    for (const prickleId of prickleIds) {
      const batch = Array.from({ length: ATTENDANCE_ROWS_PER_PRICKLE }, (_, i) => ({
        member_id: testMemberId,
        prickle_id: prickleId,
        join_time: `2099-01-01T10:${String(i % 60).padStart(2, '0')}:00Z`,
        leave_time: `2099-01-01T10:${String(i % 60).padStart(2, '0')}:30Z`,
        confidence_score: 'high',
      }))
      // Insert in chunks of 500 (CLAUDE.md batching guidance)
      for (let i = 0; i < batch.length; i += 500) {
        const { error } = await supabase.from('prickle_attendance').insert(batch.slice(i, i + 500))
        if (error) throw error
      }
    }
  })

  afterAll(async () => {
    await supabase.from('prickle_attendance').delete().eq('member_id', testMemberId)
    for (const prickleId of prickleIds) {
      await supabase.from('prickles').delete().eq('id', prickleId)
    }
    await supabase.from('members').delete().eq('id', testMemberId)
  })

  it('inserted exactly 1200 attendance rows for the test member (sanity check)', async () => {
    const { count, error } = await supabase
      .from('prickle_attendance')
      .select('*', { count: 'exact', head: true })
      .eq('member_id', testMemberId)

    expect(error).toBeNull()
    expect(count).toBe(1200)
  })

  it('recovers every attendance row via unfiltered pagination, with none lost past the 1000-row boundary', async () => {
    const allRows = await fetchAllAttendanceUnfiltered()
    const myRows = allRows.filter((r) => r.member_id === testMemberId)

    expect(myRows.length).toBe(1200)
  })

  it('computes DISTINCT prickle_id metrics correctly at this scale (leave/rejoin dedup per CLAUDE.md)', async () => {
    const allRows = await fetchAllAttendanceUnfiltered()
    const metrics = computeMemberEngagementMetrics(allRows, [testMemberId], new Date('2100-01-01'))

    // 1200 attendance rows collapse to 3 distinct prickles attended.
    expect(metrics.get(testMemberId)?.totalPrickles).toBe(3)
  })
})
