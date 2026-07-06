import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders, getTestApiBaseUrl } from '../../helpers/supabase'

/**
 * Integration tests verifying that report routes paginate large tables.
 *
 * Supabase silently caps unpaginated queries at 1000 rows. Each test below
 * inserts just enough rows to push a critical record past the 1000-row mark,
 * then asserts the API response correctly reflects that record — proving
 * pagination works end-to-end.
 */
describe('Report Route Pagination', () => {
  const supabase = getTestSupabaseAdminClient()
  const ts = Date.now()

  // ─── GET /api/reports/name-matching ────────────────────────────────────────
  // zoom_attendees is a large Bronze table (all historical Zoom participants).
  // The route counts how many times each name appears; without pagination,
  // names that appear only in rows 1001+ are silently under-counted (or missed).
  //
  // Strategy: insert 334 names × 3 rows = 1002 rows, all with zzz- prefix so
  // they sort after real data (ORDER BY name).  Names 0001–0333 fill rows 1–999
  // relative to the test data; name 0334 fills rows 1000–1002.
  // The route only reports names with count >= 3:
  //   Without pagination: name 0334 appears once → excluded from count
  //   With pagination:    name 0334 appears three times → included in count
  // The test uses a differential: count(all 1002 rows) - count(999 rows) == 1,
  // eliminating any dependency on a pre-run baseline.
  describe('GET /api/reports/name-matching — zoom_attendees pagination', () => {
    const NAME_PREFIX = `zzz-nm-pg-${ts}-`
    const UNIQUE_NAMES = 334      // 333 × 3 = 999 rows; name 334 at rows 1000–1002
    const ROWS_PER_NAME = 3       // route threshold: appearances >= 3 to flag a name

    beforeAll(async () => {
      // Ensure no leftover data from a previous failed run
      await supabase.schema('bronze').from('zoom_attendees')
        .delete().like('name', `${NAME_PREFIX}%`)

      // Build 1002 rows: 334 unique names × 3 occurrences each
      const rows: any[] = []
      for (let i = 1; i <= UNIQUE_NAMES; i++) {
        const name = `${NAME_PREFIX}${String(i).padStart(4, '0')}`
        for (let j = 0; j < ROWS_PER_NAME; j++) {
          rows.push({
            meeting_id: `${NAME_PREFIX}${i}-${j}`,
            meeting_uuid: `${NAME_PREFIX}${i}-${j}`,
            name,
            email: `${NAME_PREFIX}${i}@example.com`,
            join_time: `2099-07-01T${String(i % 24).padStart(2, '0')}:${String(j * 10).padStart(2, '0')}:00Z`,
            leave_time: `2099-07-01T${String(i % 24).padStart(2, '0')}:${String(j * 10 + 5).padStart(2, '0')}:00Z`,
            duration: 5,
          })
        }
      }

      const CHUNK = 500
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await supabase.schema('bronze').from('zoom_attendees')
          .insert(rows.slice(i, i + CHUNK))
        expect(error).toBeNull()
      }
    }, 60000)

    afterAll(async () => {
      await supabase.schema('bronze').from('zoom_attendees')
        .delete().like('name', `${NAME_PREFIX}%`)
    })

    it('should count zoom names past row 1000 toward the unmatched total', async () => {
      // Sanity: confirm all 1002 rows were inserted
      const { count: insertedCount } = await supabase.schema('bronze').from('zoom_attendees')
        .select('id', { count: 'exact', head: true })
        .like('name', `${NAME_PREFIX}%`)
      expect(insertedCount).toBe(UNIQUE_NAMES * ROWS_PER_NAME)

      // Query with all 1002 rows present (name 0334 occupies rows 1000–1002 in ORDER BY name)
      const responseFull = await fetch(`${getTestApiBaseUrl()}/api/reports/name-matching`, {
        headers: getTestAuthHeaders(),
      })
      expect(responseFull.ok).toBe(true)
      const countFull = (await responseFull.json()).unmatchedZoomAttendees?.count ?? 0

      // Remove name 0334's 3 rows so only 999 test rows remain (all within the 1000-row limit)
      const name0334 = `${NAME_PREFIX}${String(UNIQUE_NAMES).padStart(4, '0')}`
      await supabase.schema('bronze').from('zoom_attendees').delete().eq('name', name0334)

      // Query with 999 rows (name 0334 absent)
      const responsePartial = await fetch(`${getTestApiBaseUrl()}/api/reports/name-matching`, {
        headers: getTestAuthHeaders(),
      })
      expect(responsePartial.ok).toBe(true)
      const countPartial = (await responsePartial.json()).unmatchedZoomAttendees?.count ?? 0

      // Restore name 0334 so afterAll cleanup finds all rows
      const rows0334: any[] = []
      for (let j = 0; j < ROWS_PER_NAME; j++) {
        rows0334.push({
          meeting_id: `${NAME_PREFIX}${UNIQUE_NAMES}-${j}`,
          meeting_uuid: `${NAME_PREFIX}${UNIQUE_NAMES}-${j}`,
          name: name0334,
          email: `${NAME_PREFIX}${UNIQUE_NAMES}@example.com`,
          join_time: `2099-07-01T${String(UNIQUE_NAMES % 24).padStart(2, '0')}:${String(j * 10).padStart(2, '0')}:00Z`,
          leave_time: `2099-07-01T${String(UNIQUE_NAMES % 24).padStart(2, '0')}:${String(j * 10 + 5).padStart(2, '0')}:00Z`,
          duration: 5,
        })
      }
      await supabase.schema('bronze').from('zoom_attendees').insert(rows0334)

      // Differential: name 0334 sits at rows 1000–1002 (ORDER BY name, zzz- sorts last).
      // With pagination the route sees all 1002 rows → name 0334 counted.
      // Without pagination only the first 1000 rows are read → name 0334 missed.
      // Any other unmatched names in the DB affect both queries equally, so the diff is stable.
      expect(countFull - countPartial).toBe(1)
    }, 30000)

    it('should verify pagination code exists in name-matching route', async () => {
      const fs = await import('fs/promises')
      const path = await import('path')
      const content = await fs.readFile(
        path.join(process.cwd(), 'app/api/reports/name-matching/route.ts'), 'utf-8'
      )
      // All four large-table queries must use while-loop pagination
      const whileCount = (content.match(/while \(hasMore\)/g) ?? []).length
      expect(whileCount).toBeGreaterThanOrEqual(4)
      expect(content).toContain('from("zoom_attendees")')
      expect(content).toContain('from("prickle_attendance")')
      // Must not use the old single-shot pattern for these tables
      expect(content).not.toMatch(/const\s*\{\s*data:\s*allZoomNames\s*\}/)
      expect(content).not.toMatch(/const\s*\{\s*data:\s*matchedAttendance\s*\}/)
    })
  })

  // ─── GET /api/reports/unmatched-slack-users ────────────────────────────────
  // slack_messages is a large Bronze table. The route fetches ALL rows to build
  // per-user message counts (used for activity-based sorting). Without pagination,
  // counts are capped at 1000 — users with >1000 messages are mis-ranked.
  describe('GET /api/reports/unmatched-slack-users — slack_messages pagination', () => {
    const testUserId = `zzz-slack-pg-${ts}`
    const testChannelId = `zzz-slack-pg-${ts}`
    const MESSAGE_COUNT = 1001

    beforeAll(async () => {
      await supabase.schema('bronze').from('slack_messages').delete().eq('channel_id', testChannelId)
      await supabase.schema('bronze').from('slack_users').delete().eq('user_id', testUserId)

      // Insert a Slack user that won't match any member (unique zzz- email/name)
      const { error: userError } = await supabase.schema('bronze').from('slack_users').insert({
        user_id: testUserId,
        email: `zzz-slack-pg-${ts}@example.com`,
        real_name: `ZZZ Pagination Test ${ts}`,
        display_name: `zzz-pg-${ts}`,
        is_bot: false,
        raw_payload: {},
      })
      expect(userError).toBeNull()

      // Insert 1001 messages for that user — one more than the unpaginated cap
      const messages: any[] = []
      for (let i = 0; i < MESSAGE_COUNT; i++) {
        messages.push({
          user_id: testUserId,
          channel_id: testChannelId,
          message_ts: `${ts}.${String(i).padStart(6, '0')}`,
          channel_name: 'zzz-test',
          text: `pagination test message ${i}`,
          occurred_at: new Date(ts + i * 1000).toISOString(),
          raw_payload: {},
        })
      }

      const CHUNK = 500
      for (let i = 0; i < messages.length; i += CHUNK) {
        const { error } = await supabase.schema('bronze').from('slack_messages')
          .insert(messages.slice(i, i + CHUNK))
        expect(error).toBeNull()
      }
    }, 60000)

    afterAll(async () => {
      await supabase.schema('bronze').from('slack_messages').delete().eq('channel_id', testChannelId)
      await supabase.schema('bronze').from('slack_users').delete().eq('user_id', testUserId)
    })

    it('should count all messages past row 1000 for accurate activity ranking', async () => {
      // Sanity: confirm all 1001 messages were inserted
      const { count } = await supabase.schema('bronze').from('slack_messages')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', testUserId)
      expect(count).toBe(MESSAGE_COUNT)

      const response = await fetch(`${getTestApiBaseUrl()}/api/reports/unmatched-slack-users`, {
        headers: getTestAuthHeaders(),
      })
      expect(response.ok).toBe(true)
      const result = await response.json()

      // Without pagination: message_count = 1000 (truncated at Supabase default)
      // With pagination:    message_count = 1001 (complete)
      const testUser = result.unmatched?.find((u: any) => u.slack_user_id === testUserId)
      expect(testUser, `Expected user ${testUserId} in unmatched list`).toBeDefined()
      expect(testUser.message_count).toBe(MESSAGE_COUNT)
    }, 30000)

    it('should verify pagination code exists in unmatched-slack-users route', async () => {
      const fs = await import('fs/promises')
      const path = await import('path')
      const content = await fs.readFile(
        path.join(process.cwd(), 'app/api/reports/unmatched-slack-users/route.ts'), 'utf-8'
      )
      expect(content).toContain('while (hasMore)')
      expect(content).toContain('from("slack_messages")')
      // Must not use the old single-shot destructuring for slack_messages
      expect(content).not.toMatch(/\{\s*data:\s*slackMessages\s*[,}]/)
    })
  })

  // ─── GET /api/members/network ──────────────────────────────────────────────
  // prickle_attendance has 10k+ rows in production. Without pagination the
  // co-attendance graph is silently incomplete — connections between members
  // whose attendance records fall past row 1000 are never calculated.
  // Seeding 1000+ prickle_attendance rows requires many members and prickles,
  // so we verify the fix via a source-code check.
  describe('GET /api/members/network — prickle_attendance pagination', () => {
    it('should verify both large-table queries are paginated in the network route', async () => {
      const fs = await import('fs/promises')
      const path = await import('path')
      const content = await fs.readFile(
        path.join(process.cwd(), 'app/api/members/network/route.ts'), 'utf-8'
      )
      // Both members and prickle_attendance queries must use pagination loops
      const whileCount = (content.match(/while \(hasMore\)/g) ?? []).length
      expect(whileCount).toBeGreaterThanOrEqual(2)
      expect(content).toContain('from("prickle_attendance")')
      expect(content).toContain('from("members")')
      expect(content).toContain('.range(offset, offset + 999)')
      // Must not have the old single-shot pattern
      expect(content).not.toMatch(/const\s*\{\s*data:\s*attendance\s*\}\s*=\s*await\s+supabase/)
    })
  })
})
