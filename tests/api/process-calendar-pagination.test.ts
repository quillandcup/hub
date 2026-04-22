import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestSupabaseAdminClient } from '../helpers/supabase'

/**
 * Integration test to ensure calendar processing handles >1000 events
 *
 * CRITICAL: Supabase has a default 1000-row limit. This test prevents
 * regression where pagination was removed during optimization.
 */
describe('Calendar Processing Pagination', () => {
  const supabase = getTestSupabaseAdminClient()

  describe('pagination requirement', () => {
    it('should handle >1000 calendar events without truncation', async () => {
      // This test verifies the pagination pattern exists by checking
      // that we can insert and then query >1000 calendar events

      const testDateFrom = '2099-01-01T00:00:00Z'
      const testDateTo = '2099-12-31T23:59:59Z'

      // Clean up any existing test data
      await supabase
        .from('bronze.calendar_events')
        .delete()
        .gte('start_time', testDateFrom)
        .lte('end_time', testDateTo)

      // Create 1500 test calendar events
      const testEvents = Array.from({ length: 1500 }, (_, i) => ({
        google_event_id: `test-event-${i}-${Date.now()}`,
        summary: `Test Event ${i}`,
        start_time: new Date(2099, 0, 1 + Math.floor(i / 24), 10 + (i % 24), 0).toISOString(),
        end_time: new Date(2099, 0, 1 + Math.floor(i / 24), 11 + (i % 24), 0).toISOString(),
        creator_email: 'test@example.com',
        organizer_email: 'test@example.com',
        raw_data: {},
        imported_at: new Date().toISOString(),
      }))

      // Insert in chunks (Supabase insert limit)
      const CHUNK_SIZE = 500
      for (let i = 0; i < testEvents.length; i += CHUNK_SIZE) {
        const chunk = testEvents.slice(i, i + CHUNK_SIZE)
        const { error } = await supabase.from('bronze.calendar_events').insert(chunk)
        expect(error).toBeNull()
      }

      // Verify all 1500 were inserted
      const { count, error: countError } = await supabase
        .from('bronze.calendar_events')
        .select('id', { count: 'exact', head: true })
        .gte('start_time', testDateFrom)
        .lte('end_time', testDateTo)

      expect(countError).toBeNull()
      expect(count).toBe(1500)

      // Now test that a query fetching them all uses pagination
      // We simulate what the API route does
      let allFetched: any[] = []
      let offset = 0
      const BATCH_SIZE = 1000
      let hasMore = true

      while (hasMore) {
        const { data: batch, error } = await supabase
          .from('bronze.calendar_events')
          .select('*')
          .gte('start_time', testDateFrom)
          .lte('end_time', testDateTo)
          .order('start_time')
          .range(offset, offset + BATCH_SIZE - 1)

        expect(error).toBeNull()

        if (batch && batch.length > 0) {
          allFetched = allFetched.concat(batch)
          offset += batch.length
          hasMore = batch.length === BATCH_SIZE
        } else {
          hasMore = false
        }
      }

      // CRITICAL ASSERTION: All 1500 events should be fetched
      expect(allFetched.length).toBe(1500)

      // Clean up test data
      await supabase
        .from('bronze.calendar_events')
        .delete()
        .gte('start_time', testDateFrom)
        .lte('end_time', testDateTo)
    })

    it('should verify pagination code exists in route', async () => {
      // This is a code inspection test - verifies the actual route file
      // contains the pagination pattern
      const fs = await import('fs/promises')
      const path = await import('path')

      const routePath = path.join(
        process.cwd(),
        'app/api/process/calendar/route.ts'
      )

      const routeContent = await fs.readFile(routePath, 'utf-8')

      // Verify pagination keywords exist in the file
      expect(routeContent).toContain('while (hasMore)')
      expect(routeContent).toContain('range(offset')
      expect(routeContent).toContain('FETCH_BATCH_SIZE')

      // Verify it fetches calendar_events with range
      expect(routeContent).toContain('from("calendar_events")')
      expect(routeContent).toMatch(/range\(offset,\s*offset\s*\+\s*FETCH_BATCH_SIZE\s*-\s*1\)/)
    })
  })

  describe('performance patterns', () => {
    it('should use Promise.all for parallel reference data loading', async () => {
      // Prevent regression where parallel loading was replaced with sequential
      const fs = await import('fs/promises')
      const path = await import('path')

      const routePath = path.join(
        process.cwd(),
        'app/api/process/calendar/route.ts'
      )

      const routeContent = await fs.readFile(routePath, 'utf-8')

      // Should have Promise.all for loading reference data
      expect(routeContent).toContain('Promise.all([')
      expect(routeContent).toContain('members')
      expect(routeContent).toContain('prickle_types')
    })

    it('should batch database writes', async () => {
      // Prevent regression where batching was removed
      const fs = await import('fs/promises')
      const path = await import('path')

      const routePath = path.join(
        process.cwd(),
        'app/api/process/calendar/route.ts'
      )

      const routeContent = await fs.readFile(routePath, 'utf-8')

      // Should have chunking function and batch inserts
      expect(routeContent).toContain('chunk(')
      expect(routeContent).toContain('CHUNK_SIZE')
    })
  })
})
