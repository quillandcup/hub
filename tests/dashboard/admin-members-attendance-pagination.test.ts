import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../helpers/supabase'
import { computeMemberEngagementMetrics } from '@/lib/member-engagement'

/**
 * Regression test for the /admin/members?filter=all Bad Request bug (commit 50816d9).
 *
 * The page used to fetch attendance with `.in("member_id", memberIds)`. With the
 * "all" filter, memberIds could grow long enough to exceed Supabase's gateway URL
 * length limit, returning a 400 that crashed the page. The fix fetches attendance
 * unfiltered via pagination (same helper the CLAUDE.md pagination rule requires for
 * tables >1000 rows) and filters in memory instead.
 *
 * The engagement scoring pipeline now sources attendance from
 * `member_activities` (activity_type='prickle_attended') rather than
 * `prickle_attendance` directly — see reprocess_prickle_attendance_atomic,
 * which mirrors one row per (member_id, prickle_id) into member_activities
 * atomically. This test seeds that mirror table directly (rather than the
 * full prickle_attendance + prickles substrate) since that's the table
 * `fetchAllPrickleAttended()` in app/(admin)/admin/members/page.tsx actually
 * paginates over — reproducing the exact fetch algorithm the page now uses
 * (unfiltered, paginated in batches of 1000) confirms it recovers every row
 * for a member with more than 1000 prickle_attended activities without loss.
 */
describe('Admin members page — attendance pagination (no member_id filter)', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()
  const testEmail = `pagination-test-${ts}@example.com`

  let testMemberId: string
  const ROW_COUNT = 1200

  // Mirrors fetchAllPrickleAttended() in app/(admin)/admin/members/page.tsx
  // exactly — no `.in("member_id", ...)` filter, just unfiltered pagination.
  async function fetchAllPrickleAttendedUnfiltered(): Promise<{ member_id: string; occurred_at: string }[]> {
    const BATCH = 1000
    const rows: { member_id: string; occurred_at: string }[] = []
    let offset = 0
    let hasMore = true

    while (hasMore) {
      const { data, error } = await supabase
        .from('member_activities')
        .select('member_id, occurred_at')
        .eq('activity_type', 'prickle_attended')
        .order('occurred_at', { ascending: true })
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

    // member_activities.prickle_id is left null by the mirror (it points via
    // related_id, a plain text column with no FK) — so this can seed distinct
    // "prickles attended" without needing real prickles/prickle_attendance rows.
    const rows = Array.from({ length: ROW_COUNT }, (_, i) => ({
      member_id: testMemberId,
      activity_type: 'prickle_attended',
      activity_category: 'event',
      title: 'Attended a Prickle',
      actor_kind: 'member',
      related_id: `pagination-test-prickle-${ts}-${i}`,
      engagement_value: 10,
      occurred_at: `2099-01-01T${String(i % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`,
      source: 'prickle_attendance',
    }))
    // Insert in chunks of 500 (CLAUDE.md batching guidance)
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from('member_activities').insert(rows.slice(i, i + 500))
      if (error) throw error
    }
  })

  afterAll(async () => {
    await supabase.from('member_activities').delete().eq('member_id', testMemberId)
    await supabase.from('members').delete().eq('id', testMemberId)
  })

  it('inserted exactly 1200 prickle_attended activities for the test member (sanity check)', async () => {
    const { count, error } = await supabase
      .from('member_activities')
      .select('*', { count: 'exact', head: true })
      .eq('member_id', testMemberId)
      .eq('activity_type', 'prickle_attended')

    expect(error).toBeNull()
    expect(count).toBe(ROW_COUNT)
  })

  it('recovers every prickle_attended activity via unfiltered pagination, with none lost past the 1000-row boundary', async () => {
    const allRows = await fetchAllPrickleAttendedUnfiltered()
    const myRows = allRows.filter((r) => r.member_id === testMemberId)

    expect(myRows.length).toBe(ROW_COUNT)
  })

  it('computes totalPrickles correctly at this scale', async () => {
    const allRows = await fetchAllPrickleAttendedUnfiltered()
    const metrics = computeMemberEngagementMetrics(allRows, [testMemberId], new Date('2100-01-01'))

    // Dedup across leave/rejoin now happens upstream in the SQL mirror
    // (reprocess_prickle_attendance_atomic) — this function just counts
    // what it's given, one row per prickle attended.
    expect(metrics.get(testMemberId)?.totalPrickles).toBe(ROW_COUNT)
  })
})
