import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient, getTestAuthHeaders } from '../helpers/supabase'
import { seedReferenceData } from '../helpers/seed-data'

/**
 * Integration tests verifying that attendance processing paginates zoom_attendees
 * and the hygiene page paginates prickles — both tables exceed 1000 rows in production.
 *
 * Bug that prompted these: two unpaginated queries caused "Process Orphaned Meetings"
 * to show no progress:
 *
 * 1. /api/process/attendance fetched zoom_attendees without .range(), so Supabase
 *    silently capped at 1000 rows. For a wide date range, most orphaned meetings
 *    were simply never read.
 *
 * 2. The hygiene page fetched all prickles without pagination (~5500 in prod).
 *    Newly created PUPs were outside the truncated 1000-row window, so the
 *    orphaned-meeting check still reported the same count after processing.
 */
describe('Attendance Processing Pagination', () => {
  const supabase = getTestSupabaseAdminClient()

  // Use a per-run prefix so parallel test files don't interfere
  const testTs = Date.now()
  const MEETING_PREFIX = `atnd-pagination-${testTs}-meeting`

  // 11 meetings × 100 attendees = 1100 rows, which exceeds the 1000-row default
  const MEETING_COUNT = 11
  const ATTENDEES_PER_MEETING = 100

  // 2099-08-15: date range unlikely to clash with any other test
  const BASE_DATE = new Date('2099-08-15T00:00:00Z')
  const FROM_DATE = BASE_DATE.toISOString()
  const TO_DATE = new Date(BASE_DATE.getTime() + MEETING_COUNT * 60 * 60 * 1000).toISOString()

  beforeAll(async () => {
    await seedReferenceData()
    // Clean up leftover data from any previous failed run
    await supabase.schema('bronze').from('zoom_attendees')
      .delete().like('meeting_uuid', `${MEETING_PREFIX}-%`)
    await supabase.from('prickles')
      .delete().like('zoom_meeting_uuid', `${MEETING_PREFIX}-%`).eq('source', 'zoom')
  })

  afterAll(async () => {
    await supabase.schema('bronze').from('zoom_attendees')
      .delete().like('meeting_uuid', `${MEETING_PREFIX}-%`)
    await supabase.from('prickles')
      .delete().like('zoom_meeting_uuid', `${MEETING_PREFIX}-%`).eq('source', 'zoom')
  })

  describe('pagination requirement', () => {
    it('should process all meetings when zoom_attendees exceed 1000 rows', async () => {
      // ARRANGE: Build 1100 attendee records across 11 meetings.
      // Each meeting occupies one hour; attendees join at 1-minute intervals within that hour.
      // Sorted by join_time: meetings 0-9 fill the first 1000 rows exactly.
      // Without pagination, meeting 10 would be silently skipped.
      const attendees: any[] = []
      for (let i = 0; i < MEETING_COUNT; i++) {
        const meetingUuid = `${MEETING_PREFIX}-${i}`
        const meetingStart = new Date(BASE_DATE.getTime() + i * 60 * 60 * 1000)
        for (let j = 0; j < ATTENDEES_PER_MEETING; j++) {
          attendees.push({
            meeting_id: meetingUuid,
            meeting_uuid: meetingUuid,
            name: 'Test Seed Member',
            email: 'test-seed-member@example.com',
            join_time: new Date(meetingStart.getTime() + j * 60 * 1000).toISOString(),
            leave_time: new Date(meetingStart.getTime() + (j + 1) * 60 * 1000).toISOString(),
            duration: 1,
          })
        }
      }

      // Insert in batches of 500 (Supabase insert limit)
      const CHUNK = 500
      for (let i = 0; i < attendees.length; i += CHUNK) {
        const { error } = await supabase.schema('bronze').from('zoom_attendees')
          .insert(attendees.slice(i, i + CHUNK))
        expect(error).toBeNull()
      }

      // Verify all 1100 were inserted
      const { count, error: countError } = await supabase
        .schema('bronze').from('zoom_attendees')
        .select('id', { count: 'exact', head: true })
        .like('meeting_uuid', `${MEETING_PREFIX}-%`)
      expect(countError).toBeNull()
      expect(count).toBe(MEETING_COUNT * ATTENDEES_PER_MEETING)

      // ACT: Process attendance for the full date range
      const response = await fetch('http://localhost:3000/api/process/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getTestAuthHeaders() },
        body: JSON.stringify({ fromDate: FROM_DATE, toDate: TO_DATE }),
      })

      expect(response.ok).toBe(true)
      const result = await response.json()

      // ASSERT: All 11 meetings processed, not just the first 10 (from the first 1000 rows)
      // Old unpaginated code: meetingsProcessed = 10
      // New paginated code:   meetingsProcessed = 11
      expect(result.meetingsProcessed).toBeGreaterThanOrEqual(MEETING_COUNT)
      expect(result.createdNewPrickles).toBeGreaterThanOrEqual(MEETING_COUNT)

      // Verify prickles were actually created in the DB for our specific meeting UUIDs.
      // This rules out the route coincidentally returning high counts from unrelated data.
      const { data: createdPrickles, error: pricklesError } = await supabase
        .from('prickles')
        .select('id, zoom_meeting_uuid')
        .like('zoom_meeting_uuid', `${MEETING_PREFIX}-%`)
        .eq('source', 'zoom')
      expect(pricklesError).toBeNull()
      expect(createdPrickles).toHaveLength(MEETING_COUNT)
    }, 60000)

    it('should verify pagination code exists in attendance route', async () => {
      const fs = await import('fs/promises')
      const path = await import('path')
      const routePath = path.join(process.cwd(), 'app/api/process/attendance/route.ts')
      const content = await fs.readFile(routePath, 'utf-8')

      // Pagination loop must exist for zoom_attendees
      expect(content).toContain('while (hasMore)')
      expect(content).toContain('.range(offset, offset + BATCH - 1)')
      expect(content).toContain('from("zoom_attendees")')

      // Must NOT use an unpaginated single-shot query for zoom_attendees
      // (the old pattern was: const { data: zoomAttendees } = await supabase...select("*")...order("join_time"))
      expect(content).not.toMatch(/const\s*\{\s*data:\s*zoomAttendees\s*[,}].*from\("zoom_attendees"\)/s)
    })
  })

  describe('hygiene page pagination', () => {
    it('should verify prickles are fetched with pagination in hygiene page', async () => {
      const fs = await import('fs/promises')
      const path = await import('path')
      const pagePath = path.join(process.cwd(), 'app/(admin)/admin/hygiene/page.tsx')
      const content = await fs.readFile(pagePath, 'utf-8')

      // allPricklesForOverlap must be built via a pagination loop, not a single query
      expect(content).toContain('allPricklesForOverlap.push(...batch)')

      // The old single-shot pattern must be gone
      expect(content).not.toMatch(/const\s*\{\s*data:\s*allPricklesForOverlap\s*\}\s*=\s*await\s+supabase/)
    })
  })
})
